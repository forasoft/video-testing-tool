import { describe, expect, it } from "vitest";
import { AudioStutter } from "src/session/problems/audioStutter";
import { makeSamples, runDetectors, Segment, STEADY, Values } from "./makeSamples";

const AUDIO: Values = {
  a_concealed_pct: 0, a_loss: 0, a_jitter: 3, a_jb: 40,
};

// The stand's Loss 20 %, second by second from the preset on: the 5-s windows of concealment and loss rise,
// Opus FEC starts to repair some of it, the preset is switched off at 16 s.
const LOSS_20 = {
  a_concealed_pct: [0, 3.1, 6.3, 9.2, 14.1, 19.5, 19, 21, 22.1, 20, 17.1, 19.7, 16.5, 15.3, 18.1, 13.5, 11.4, 8.7, 4.9, 0.5, 0, 0, 0, 0, 0],
  a_loss: [0.8, 5.2, 8, 11.6, 16.9, 21.2, 19.5, 21.9, 22.4, 19.6, 18.4, 20.6, 17.7, 16.9, 19.7, 15.1, 12.7, 9.6, 4.8, 0.4, 0, 0, 0, 0, 0],
  a_jitter: [4, 4, 3, 3, 4, 3, 4, 3, 3, 3, 3, 5, 3, 2, 3, 3, 3, 2, 3, 3, 3, 3, 3, 3, 3],
  a_jb: [329, 320, 302, 300, 295, 291, 284, 255, 246, 252, 250, 174, 158, 129, 129, 129, 119, 103, 100, 99, 99, 99, 99, 99, 99],
};

// The recorded seconds from `from` on.
const recorded = (from: number, series: Record<string, number[]>, scale = 1): Segment => ({
  from,
  to: from + series.a_concealed_pct.length,
  values: Object.fromEntries(Object.entries(series).map(([field, values]) => [
    field,
    (t: number) => (field === "a_concealed_pct" ? values[t - from] * scale : values[t - from]),
  ])),
});

const run = (segments: Segment[], duration = 80) =>
  runDetectors([new AudioStutter()], makeSamples({ duration, base: { ...STEADY, ...AUDIO }, segments }));

// PRD §12.3, problem 7.
describe("Audio stutter", () => {
  it("opens when the 5-s window of concealment passes 5 %, ends at the first of 5 calm samples, severe above a 20 % peak", () => {
    const { problems, sent } = run([recorded(30, LOSS_20)]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      type: "audio_stutter",
      title: "Audio stutter",
      category: "Network",
      severity: "severe",
      tStart: 32,
      tEnd: 49,
      open: false,
      oneLine: "22.1 % concealed",
    });
    expect(problems[0].card.rows).toEqual([
      ["Concealed", "peak 22.1 %"],
      ["Audio packet loss", "22.4 %"],
      ["Audio jitter", "5 ms"],
      ["Audio jitter buffer", "302 ms"],
    ]);
    expect(problems[0].card.likelyCause).toBe("Audio packets arrived late or not at all: loss 22.4 %, jitter 5 ms.");
    expect(problems[0].card.check).toBe("Same network checks as Bandwidth drop; if video was fine at the same time — audio-only path or sender microphone pipeline.");
    expect(problems[0].card.series.name).toBe("a_concealed_pct");
    // warn until the peak passes 20 %.
    expect(sent[0]).toMatchObject({ severity: "warn", oneLine: "9.2 % concealed", open: true });
  });

  it("is warn with a peak of 20 % or less", () => {
    const { problems } = run([recorded(30, LOSS_20, 0.5)]);

    expect(problems).toEqual([expect.objectContaining({ severity: "warn", oneLine: "11.1 % concealed", tStart: 34 })]);
  });

  it("needs more than 5 % to start", () => {
    expect(run([{ from: 30, to: 50, values: { a_concealed_pct: 5 } }]).problems).toEqual([]);
  });

  it("needs 5 calm samples in a row to end; a window without audio counts as calm", () => {
    const bumpy = run([
      { from: 30, to: 40, values: { a_concealed_pct: 12 } },
      { from: 43, to: 44, values: { a_concealed_pct: 3 } },
    ]);
    expect(bumpy.problems).toEqual([expect.objectContaining({ tStart: 30, tEnd: 44 })]);

    const silent = run([
      { from: 30, to: 40, values: { a_concealed_pct: 12 } },
      { from: 40, to: 81, values: { a_concealed_pct: null, a_loss: null } },
    ]);
    expect(silent.problems).toEqual([expect.objectContaining({ tStart: 30, tEnd: 40 })]);
  });
});
