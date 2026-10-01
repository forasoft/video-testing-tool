import { describe, expect, it } from "vitest";
import { SampleValues } from "shared/constants/sampleFields";
import { emptySample } from "src/session/metrics";
import {
  areaPath, lastWindow, linePath, maxIn, nice, runs, ticks
} from "../../popup/src/components/expanded/timeline/scale";
import { delayStack, pointsOf } from "../../popup/src/components/expanded/timeline/series";

// Popup's timeline charts (PRD §11.2): the helpers that turn samples into axes and paths.
describe("timeline scale", () => {
  it("rounds an axis maximum up to a number whose half is round too", () => {
    // Bitrate: nice(max × 1.2).
    expect(nice(2160)).toBe(2500);
    expect(nice(2520)).toBe(3000);
    expect(nice(1440)).toBe(1500);
    expect(nice(360)).toBe(400);
    // Frame rate: nice(max × 1.1) of a 30–31 fps stream.
    expect(nice(33)).toBe(40);
    expect(nice(34.1)).toBe(40);
    // Already round, fractions, no value.
    expect(nice(3000)).toBe(3000);
    expect(nice(1200)).toBe(1200);
    expect(nice(0.3)).toBe(0.3);
    expect(nice(0)).toBe(0);
    expect(nice(-5)).toBe(0);
  });

  it("shows the last 2 minutes, and the whole session while it is shorter", () => {
    const late = lastWindow(137.3);
    expect(late.from).toBeCloseTo(17.3, 9);
    expect(late.to).toBe(137.3);
    expect(lastWindow(45)).toEqual({ from: 0, to: 45 });
    expect(lastWindow(120)).toEqual({ from: 0, to: 120 });
    // The very first sample still has an axis.
    expect(lastWindow(0)).toEqual({ from: 0, to: 1 });
  });

  it("labels the time axis every 20 s inside the window", () => {
    expect(ticks({ from: 0, to: 120 }, 20)).toEqual([0, 20, 40, 60, 80, 100, 120]);
    expect(ticks({ from: 17.3, to: 137.3 }, 20)).toEqual([20, 40, 60, 80, 100, 120]);
    expect(ticks({ from: 0, to: 45 }, 20)).toEqual([0, 20, 40]);
  });

  it("takes the maximum inside the window only, of all given series", () => {
    const bitrate = [{ t: 10, v: 5000 }, { t: 20, v: 1200 }, { t: 30, v: null }, { t: 40, v: 900 }];
    const channel = [{ t: 20, v: 2400 }];

    expect(maxIn({ from: 15, to: 45 }, bitrate)).toBe(1200);
    expect(maxIn({ from: 15, to: 45 }, bitrate, channel)).toBe(2400);
    expect(maxIn({ from: 50, to: 60 }, bitrate)).toBe(0);
  });

  it("breaks the line where a value is null and draws a lone point as a dot", () => {
    const points = [{ t: 0, v: 10 }, { t: 1, v: 20 }, { t: 2, v: null }, { t: 3, v: 30 }, { t: 4, v: null }];
    const x = (t: number) => t * 10;
    const y = (v: number) => 100 - v;

    expect(runs(points)).toEqual([[{ t: 0, v: 10 }, { t: 1, v: 20 }], [{ t: 3, v: 30 }]]);
    expect(linePath(points, x, y)).toBe("M0.0 90.0L10.0 80.0M30.0 70.0h0.01");
    expect(areaPath(points, x, y)).toBe("M0.0 100.0L0.0 90.0L10.0 80.0L10.0 100.0ZM30.0 100.0L30.0 70.0L30.0 100.0Z");
    expect(linePath([{ t: 0, v: null }], x, y)).toBe("");
  });
});

describe("timeline series", () => {
  const sample = (t: number, values: Partial<SampleValues>): SampleValues => ({ ...emptySample(), t, ...values });

  it("takes one field of the samples as points", () => {
    const samples = [sample(1, { v_loss: 0.5 }), sample(2, {})];

    expect(pointsOf(samples, "v_loss")).toEqual([{ t: 1, v: 0.5 }, { t: 2, v: null }]);
  });

  it("stacks the delay: network, + jitter buffer, + decode and render up to the video delay", () => {
    const { net, buffer, total } = delayStack([
      sample(1, { d_net: 20, d_jb: 90, d_decode: 12, d_render: 8, d_video: 130 }),
      // No RTT yet: the network layer is 0, the stack still reaches the video delay.
      sample(2, { d_jb: 95, d_decode: 10, d_render: 0, d_video: 105 }),
      // No video delay: a gap in every layer.
      sample(3, { d_net: 21 }),
    ]);

    expect(net).toEqual([{ t: 1, v: 20 }, { t: 2, v: 0 }, { t: 3, v: null }]);
    expect(buffer).toEqual([{ t: 1, v: 110 }, { t: 2, v: 95 }, { t: 3, v: null }]);
    expect(total).toEqual([{ t: 1, v: 130 }, { t: 2, v: 105 }, { t: 3, v: null }]);
  });
});
