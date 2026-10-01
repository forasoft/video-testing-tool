import { describe, expect, it } from "vitest";
import { SampleValues } from "shared/constants/sampleFields";
import { ProblemMessage } from "shared/protocol";
import { SampleBuffer } from "src/session/buffer";
import { FrameClock } from "src/session/frames";
import { historyMessage, historySeries } from "src/session/history";
import { emptySample } from "src/session/metrics";

const sample = (t: number, values: Partial<SampleValues> = {}): SampleValues => ({ ...emptySample(), t, ...values });

// Samples at the given times with the bitrate of each (null — a second without data).
const filled = (points: [number, number | null][]) => {
  const buffer = new SampleBuffer();
  points.forEach(([t, v]) => buffer.push(sample(t, { v_bitrate: v, v_fps_r: v === null ? null : 30 })));
  return buffer;
};

const problem = (id: number, tStart: number, tEnd: number | null): ProblemMessage => ({
  id,
  type: "bandwidth_drop",
  title: "Bandwidth drop",
  category: "Network",
  severity: "warn",
  tStart,
  tEnd,
  open: tEnd === null,
  oneLine: "",
  card: { series: { name: "v_bitrate", points: [] }, rows: [], likelyCause: "", check: "" },
});

describe("historySeries", () => {
  it("returns every sample of [from, to] as it is when no buckets are asked for", () => {
    const buffer = filled([[0, 100], [1, 200], [2, null], [3, 400], [4, 500]]);
    const series = historySeries(buffer, 1, 3);

    expect(series.t).toEqual([1, 2, 3]);
    expect(series.v_bitrate).toEqual([200, null, 400]);
    expect(series.v_fps_r).toEqual([30, null, 30]);
    // The fields the timeline draws, and nothing else.
    expect(Object.keys(series)).toEqual([
      "t", "v_bitrate", "avail_in", "v_fps_r", "v_loss", "d_net", "d_jb", "d_decode", "d_render", "d_video",
    ]);
  });

  it("keeps the samples as they are when there are no more of them than buckets", () => {
    const buffer = filled([[0.1, 100], [1.1, 200], [2.2, 300]]);

    expect(historySeries(buffer, 0, 3, 3).t).toEqual([0.1, 1.1, 2.2]);
    expect(historySeries(buffer, 0, 3, 720).v_bitrate).toEqual([100, 200, 300]);
  });

  it("averages the samples of each bucket: the mean time and the mean of the values present", () => {
    // 0…8 s in 4 buckets of 2 s.
    const buffer = filled([[0, 10], [1, 30], [2, null], [3, 20], [4, null], [5, null], [6, 5], [7, 7]]);
    const series = historySeries(buffer, 0, 8, 4);

    expect(series.t).toEqual([0.5, 2.5, 4.5, 6.5]);
    expect(series.v_bitrate).toEqual([20, 20, null, 6]);
  });

  it("gives no point for a bucket without samples, so the line does not break", () => {
    // Uneven samples in 1-s buckets: the buckets 1…2 s and 3…4 s get none.
    const buffer = filled([[0, 1], [0.9, 3], [2.1, 5], [2.9, 7], [4.1, 9], [5, 11]]);
    const series = historySeries(buffer, 0, 5, 5);

    expect(series.t).toEqual([0.45, 2.5, 4.55]);
    expect(series.v_bitrate).toEqual([2, 6, 10]);
  });

  it("reads a wrapped ring by time", () => {
    const buffer = new SampleBuffer(3);
    [0, 1, 2, 3, 4].forEach((t) => buffer.push(sample(t, { v_bitrate: t * 100 })));

    expect(historySeries(buffer, 0, 10).t).toEqual([2, 3, 4]);
    expect(historySeries(buffer, 0, 10).v_bitrate).toEqual([200, 300, 400]);
  });
});

describe("historyMessage", () => {
  it("adds the hidden ranges, events and problems of the range, the hidden ranges cut to it", () => {
    const buffer = filled([[10, 1], [20, 2], [30, 3]]);
    const message = historyMessage({
      buffer,
      events: [
        { n: 1, t: 1.84, kind: "first_frame", label: "First frame 1.84 s", tone: "green" },
        { n: 2, t: 15, kind: "layer_change", label: "720p → 360p", tone: "yellow", ...{ from: 720, to: 360 } },
        { n: 3, t: 40, kind: "mark", label: "Mark 1", tone: "blue" },
      ],
      problems: [problem(1, 2, 8), problem(2, 12, 18), problem(3, 28, null)],
      hidden: [{ start: 3, end: 6 }, { start: 8, end: 14 }, { start: 26, end: 33 }],
    }, { from: 10, to: 30 });

    expect(message.from).toBe(10);
    expect(message.to).toBe(30);
    expect(message.series.t).toEqual([10, 20, 30]);
    expect(message.hiddenRanges).toEqual([[10, 14], [26, 30]]);
    // Events without the detector's own fields.
    expect(message.events).toEqual([{ n: 2, t: 15, kind: "layer_change", label: "720p → 360p", tone: "yellow" }]);
    expect(message.problems.map((p) => p.id)).toEqual([2, 3]);
  });

  it("leaves the events and problems out of a refresh: the panel has them from their own messages", () => {
    const source = {
      buffer: filled([[0, 100], [1, 200], [2, 300]]),
      events: [{
        n: 1, t: 1, kind: "mark" as const, label: "Mark 1", tone: "blue" as const,
      }],
      problems: [problem(1, 0.5, 1.5)],
      hidden: [{ start: 1.2, end: 1.8 }],
    };

    const first = historyMessage(source, { from: 0, to: 2, buckets: 720 });
    const refresh = historyMessage(source, {
      from: 0, to: 2, buckets: 720, refresh: true,
    });

    expect(first.events).toHaveLength(1);
    expect(first.problems).toHaveLength(1);
    expect(refresh).toEqual({ ...first, events: [], problems: [] });
  });

  it("downsamples when the popup asks for buckets", () => {
    const points = Array.from({ length: 600 }, (_, t): [number, number] => [t, 1000]);
    const message = historyMessage({ buffer: filled(points), events: [], problems: [], hidden: [] }, { from: 0, to: 600, buckets: 100 });

    expect(message.series.t).toHaveLength(100);
    expect(message.series.t?.[0]).toBe(2.5);
    expect(message.series.v_bitrate?.every((v) => v === 1000)).toBe(true);
  });
});

describe("FrameClock skip", () => {
  it("moves the last frames with a jump of the session's clock, so that it is not a freeze (fastForward)", () => {
    const clock = new FrameClock();
    for (let t = 0; t <= 1000; t += 33) {
      clock.frame(t, null, t / 33 + 1);
    }

    clock.skip(3_600_000);
    for (let t = 3_601_023; t <= 3_602_000; t += 33) {
      clock.frame(t, null, null);
    }

    expect(clock.freezes(3_602_000)).toEqual([]);
    expect(clock.fps(3_602_000)).toBeGreaterThanOrEqual(29);
  });
});

describe("FrameClock suspensions", () => {
  it("keeps the times the tab was hidden or the video paused, the current one open", () => {
    const clock = new FrameClock();

    clock.suspend("hidden", 1000);
    clock.resume("hidden", 4000);
    // Paused, then hidden too: one suspension until both are over.
    clock.suspend("paused", 6000);
    clock.suspend("hidden", 7000);
    clock.resume("paused", 8000);
    clock.resume("hidden", 9000);
    clock.suspend("paused", 12000);

    expect(clock.suspensions(15000)).toEqual([
      { start: 1000, end: 4000 },
      { start: 6000, end: 9000 },
      { start: 12000, end: 15000 },
    ]);
    // A resume of something that was not suspended changes nothing.
    clock.resume("hidden", 13000);
    expect(clock.suspensions(16000)).toHaveLength(3);
  });

  it("tells the share of an interval that frames were not counted", () => {
    const clock = new FrameClock();
    clock.suspend("paused", 10300);
    clock.resume("paused", 13300);

    expect(clock.suspendedShare(10000, 11000)).toBeCloseTo(0.7, 9);
    expect(clock.suspendedShare(11000, 12000)).toBe(1);
    expect(clock.suspendedShare(13000, 14000)).toBeCloseTo(0.3, 9);
    expect(clock.suspendedShare(14000, 15000)).toBe(0);
    // An empty interval: whether frames are counted right now.
    expect(clock.suspendedShare(0, 0)).toBe(0);
    clock.suspend("hidden", 20000);
    expect(clock.suspendedShare(20000, 20000)).toBe(1);
    expect(clock.suspendedShare(19500, 20500)).toBe(0.5);
  });
});
