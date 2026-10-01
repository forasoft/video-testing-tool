import { describe, expect, it, vi } from "vitest";
import { SampleBuffer } from "src/session/buffer";
import { EventLog } from "src/session/events";
import {
  CARD_MARGIN_S,
  Description,
  Detector,
  median,
  Problem,
  PROBLEM_LIMIT,
  ProblemEngine,
} from "src/session/problems/engine";
import { makeSamples, runDetectors, STEADY } from "./makeSamples";

// Test detector: a problem while v_loss ≥ 5; its one-liner holds the duration so far.
const lossDetector = (overrides: Partial<Detector> = {}): Detector => ({
  type: "audio_stutter",
  onSample(engine) {
    const loss = engine.sample?.v_loss ?? 0;
    const open = engine.current("audio_stutter");
    if (!open && loss >= 5) {
      engine.open("audio_stutter", engine.t, {});
    }
    if (open && loss < 5) {
      engine.close(open, engine.t);
    }
  },
  describe(problem: Problem, engine): Description {
    return {
      title: "Loss",
      category: "Network",
      severity: "warn",
      oneLine: `${engine.duration(problem).toFixed(1)} s`,
      card: { series: engine.cardSeries("v_loss", problem), rows: [], likelyCause: "", check: "" },
    };
  },
  ...overrides,
});

const lossAt = (from: number, to: number, duration = 60) =>
  makeSamples({ duration, base: STEADY, segments: [{ from, to, values: { v_loss: 8 } }] });

describe("median", () => {
  it("takes the middle value, or the mean of the two middle ones", () => {
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});

describe("ProblemEngine", () => {
  it("numbers problems, sends them on start, on every change and at the end", () => {
    const { problems, sent } = runDetectors([lossDetector()], lossAt(10, 14));

    expect(problems).toEqual([
      expect.objectContaining({ id: 1, type: "audio_stutter", tStart: 10, tEnd: 14, open: false, oneLine: "4.0 s" }),
    ]);
    // Shown at 11 (1 s long) and updated at 12, 13, 14 (end); then only its chart grows for 15 s.
    const lines = sent.map((m) => `${m.oneLine}${m.open ? "" : " closed"}`);
    expect(lines.slice(0, 4)).toEqual(["1.0 s", "2.0 s", "3.0 s", "4.0 s closed"]);
    expect(sent.every((m) => m.id === 1)).toBe(true);
  });

  it("refreshes a closed card until 15 s after the end, then leaves it", () => {
    const describe = vi.fn(lossDetector().describe);
    const { problems } = runDetectors([lossDetector({ describe })], lossAt(10, 14, 60));

    // The chart covers the problem ± 15 s: 10 − 15 … 14 + 15.
    const { points } = problems[0].card.series;
    expect(points[0][0]).toBe(0);
    expect(points[points.length - 1][0]).toBe(14 + CARD_MARGIN_S);
    // Described at 11…29 (19 samples), not after.
    expect(describe).toHaveBeenCalledTimes(14 + CARD_MARGIN_S - 11 + 1);
  });

  it("keeps describing a closed problem that is not settled", () => {
    const describe = vi.fn(lossDetector().describe);
    runDetectors([lossDetector({ describe, settled: () => false })], lossAt(10, 14, 60));

    expect(describe).toHaveBeenCalledTimes(60 - 11 + 1);
  });

  it("drops a problem shorter than 1 s and does not use up a number for it", () => {
    const engine = new ProblemEngine({ buffer: new SampleBuffer(), events: new EventLog(), detectors: [lossDetector()] });
    const blip = engine.open("audio_stutter", 5, {});
    engine.close(blip, 5.6);
    engine.signal({ kind: "ice", t: 6, state: "connected", lastPacketT: null });
    const real = engine.open("audio_stutter", 7, {});
    engine.close(real, 9);
    engine.signal({ kind: "ice", t: 9, state: "connected", lastPacketT: null });

    expect(engine.list().map((p) => [p.id, p.tStart, p.tEnd])).toEqual([[1, 7, 9]]);
  });

  it("does not open a second problem of a type while one is open", () => {
    const engine = new ProblemEngine({ buffer: new SampleBuffer(), events: new EventLog(), detectors: [lossDetector()] });
    const first = engine.open("audio_stutter", 1, { n: 1 });
    const second = engine.open("audio_stutter", 3, { n: 2 });

    expect(second).toBe(first);
    expect(engine.problems).toHaveLength(1);
  });

  it("keeps the last 200 problems", () => {
    const segments = Array.from({ length: PROBLEM_LIMIT + 5 }, (_, i) => ({ from: 3 * i + 1, to: 3 * i + 3, values: { v_loss: 8 } }));
    const samples = makeSamples({ duration: 3 * (PROBLEM_LIMIT + 5) + 1, base: STEADY, segments });
    const { problems } = runDetectors([lossDetector()], samples);

    expect(problems).toHaveLength(PROBLEM_LIMIT);
    expect(problems[0].id).toBe(6);
    expect(problems[problems.length - 1].id).toBe(PROBLEM_LIMIT + 5);
  });

  it("ends open problems when the session finishes and ignores later samples", () => {
    const samples = lossAt(10, 60, 30);
    const { engine } = runDetectors([lossDetector()], samples.slice(0, 21));
    engine.finish(20.5);
    samples.slice(21).forEach((s) => engine.onSample(s));

    expect(engine.list()).toEqual([expect.objectContaining({ tStart: 10, tEnd: 20.5, open: false, oneLine: "10.5 s" })]);
  });

  it("gives medians of the seconds before t without the sample at t", () => {
    const samples = makeSamples({ duration: 40, base: { ...STEADY, v_bitrate: (t) => t * 10 } });
    const { engine } = runDetectors([], samples);

    // 10…39 → 245; the sample at 40 (400) is left out.
    expect(engine.medianBefore("v_bitrate", 40, 30)).toBe(245);
    expect(engine.values("v_bitrate", 38, 40)).toEqual([380, 390, 400]);
  });

  it("calls onEnd once after the step in which a detector ended the session", () => {
    const onEnd = vi.fn();
    const ender = lossDetector({
      onSample(engine) {
        if (engine.t === 5) {
          engine.endSession("test");
        }
      },
    });
    runDetectors([ender], makeSamples({ duration: 8, base: STEADY }), { onEnd });

    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith("test");
  });
});
