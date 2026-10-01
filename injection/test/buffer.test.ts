import { describe, expect, it } from "vitest";
import { BUFFER_SECONDS, SampleBuffer } from "src/session/buffer";
import { emptySample } from "src/session/metrics";
import { SPARKLINE_LENGTH, sparklines } from "src/session/sparklines";

// Sample of second t with the given bitrate (null — no data).
const at = (t: number, bitrate: number | null) => ({ ...emptySample(), t, v_bitrate: bitrate });

const filled = (values: (number | null)[], capacity?: number) => {
  const buffer = new SampleBuffer(capacity);
  values.forEach((v, t) => buffer.push(at(t, v)));
  return buffer;
};

describe("SampleBuffer", () => {
  it("keeps 60 minutes by default in one Float64Array per field", () => {
    const buffer = new SampleBuffer();

    expect(buffer.capacity).toBe(BUFFER_SECONDS);
    expect(buffer.columns.v_bitrate).toBeInstanceOf(Float64Array);
    expect(buffer.columns.v_bitrate.length).toBe(3600);
  });

  it("returns the last n values oldest first, with null for missing data", () => {
    const buffer = filled([100, null, 300, 400]);

    expect(buffer.lastN("v_bitrate", 3)).toEqual([null, 300, 400]);
    expect(buffer.lastN("v_bitrate", 10)).toEqual([100, null, 300, 400]);
    expect(buffer.lastN("t", 2)).toEqual([2, 3]);
  });

  it("overwrites the oldest second when the ring is full", () => {
    const buffer = filled([1, 2, 3, 4, 5, 6, 7], 5);

    expect(buffer.size).toBe(5);
    expect(buffer.total).toBe(7);
    expect(buffer.lastN("v_bitrate", 5)).toEqual([3, 4, 5, 6, 7]);
    expect(buffer.lastN("t", 1)).toEqual([6]);
    expect(buffer.range("v_bitrate", 0, 3)).toEqual([3, 4]);
  });

  it("selects a time range", () => {
    const buffer = filled([10, 20, 30, 40, 50]);

    expect(buffer.range("v_bitrate", 1, 3)).toEqual([20, 30, 40]);
    expect(buffer.range("v_bitrate", 10, 20)).toEqual([]);
  });

  it("finds a time range by binary search, in a wrapped ring too, as a full scan would", () => {
    const buffer = new SampleBuffer(100);
    // 250 samples 0.9…1.1 s apart: the ring has wrapped twice.
    let t = 0;
    const times: number[] = [];
    for (let i = 0; i < 250; i++) {
      t += 0.9 + ((i * 7) % 3) / 10;
      times.push(Math.round(t * 10) / 10);
      buffer.push(at(times[i], i));
    }
    const kept = times.slice(-100);
    const scan = (from: number, to: number) => kept.map((time, i) => [time, 150 + i]).filter(([time]) => time >= from && time <= to).map(([, v]) => v);

    [[0, 1000], [kept[0], kept[0]], [kept[10] + 0.05, kept[40]], [kept[99], 1e9], [kept[99] + 0.1, 1e9], [-5, kept[0] - 0.1], [kept[50], kept[49]]]
      .forEach(([from, to]) => expect(buffer.range("v_bitrate", from, to)).toEqual(scan(from, to)));
    expect(buffer.firstAt(kept[37])).toBe(37);
    expect(buffer.firstAt(1e9)).toBe(100);
  });

  it("downsamples into buckets with min, max and mean, skipping null", () => {
    const buffer = filled([10, 30, null, 20, null, null, 5, 7]);
    const result = buffer.downsample("v_bitrate", 0, 8, 4);

    expect(result.t).toEqual([0, 2, 4, 6]);
    expect(result.min).toEqual([10, 20, null, 5]);
    expect(result.max).toEqual([30, 20, null, 7]);
    expect(result.mean).toEqual([20, 20, null, 6]);
  });

  it("downsamples a wrapped ring by time", () => {
    const buffer = filled([1, 2, 3, 4, 5, 6], 4);
    const result = buffer.downsample("v_bitrate", 2, 6, 2);

    expect(result.mean).toEqual([3.5, 5.5]);
  });

  it("computes percentiles over non-null values, linear between ranks", () => {
    const buffer = filled([null, 10, 20, null, 30, 40, 50, null]);

    expect(buffer.percentile("v_bitrate", 50)).toBe(30);
    expect(buffer.percentile("v_bitrate", 0)).toBe(10);
    expect(buffer.percentile("v_bitrate", 100)).toBe(50);
    expect(buffer.percentile("v_bitrate", 95)).toBeCloseTo(48, 6);
    expect(buffer.percentile("v_bitrate", 5)).toBeCloseTo(12, 6);
    expect(buffer.percentile("v_bitrate", 50, 4, 7)).toBe(40);
  });

  it("has no percentile without values", () => {
    expect(filled([null, null]).percentile("v_bitrate", 50)).toBeNull();
    expect(new SampleBuffer().percentile("v_bitrate", 50)).toBeNull();
  });
});

describe("sparklines", () => {
  it("gives every tile 120 values, null-padded on the left in a young session", () => {
    const buffer = filled([100, 200, 300]);
    const lines = sparklines(buffer);

    expect(Object.keys(lines).sort()).toEqual(
      ["audioDelay", "bitrate", "fps", "freezes", "loss", "resolution", "videoDelay"]
    );
    expect(lines.bitrate).toHaveLength(SPARKLINE_LENGTH);
    expect(lines.bitrate.slice(-3)).toEqual([100, 200, 300]);
    expect(lines.bitrate.slice(0, SPARKLINE_LENGTH - 3).every((v) => v === null)).toBe(true);
  });

  it("keeps only the last 120 seconds, Resolution by frame height", () => {
    const buffer = new SampleBuffer();
    for (let t = 0; t < 200; t++) {
      buffer.push({ ...emptySample(), t, v_bitrate: t, v_h: 720 });
    }
    const lines = sparklines(buffer);

    expect(lines.bitrate[0]).toBe(80);
    expect(lines.bitrate[119]).toBe(199);
    expect(lines.resolution.every((v) => v === 720)).toBe(true);
  });
});
