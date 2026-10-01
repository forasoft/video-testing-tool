import { describe, expect, it } from "vitest";
import { AvSync } from "src/session/problems/avSync";
import { makeSamples, runDetectors, Segment, STEADY, Values } from "./makeSamples";

// In sync as on the stand: Chrome's playout estimates of audio and video are ~50 ms apart.
const SYNCED: Values = {
  av_offset: -53, v_jb: 8, a_jb: 38, d_video: 20,
};

// The stand's Desync: synced audio and video, then the video jitter buffer target jumps to 1 s at 11 s —
// audio runs ahead, and lip sync delays the audio step by step until they meet again.
const JUMP = {
  av_offset: [847, 790, 701, 619, 526, 480, 423, 343, 327, 274, 240, 217, 179, 165, 141, 124, 119, 104, 103, 78, 82, 68, 67],
  v_jb: [981, 980, 981, 979, 980, 980, 980, 978, 978, 978, 979, 979, 979, 979, 978, 979, 980, 978, 979, 977, 979, 979, 977],
  a_jb: [85, 147, 215, 304, 386, 458, 522, 583, 618, 656, 699, 728, 758, 778, 799, 810, 838, 838, 848, 851, 868, 870, 888],
};

const recorded = (from: number, series: Record<string, number[]>, sign = 1): Segment => ({
  from,
  to: from + series.av_offset.length,
  values: {
    av_offset: (t) => series.av_offset[t - from] * sign,
    v_jb: (t) => (sign > 0 ? series.v_jb : series.a_jb)[t - from],
    a_jb: (t) => (sign > 0 ? series.a_jb : series.v_jb)[t - from],
    d_video: (t) => (sign > 0 ? series.v_jb : series.a_jb)[t - from] + 12,
  },
});

const run = (segments: Segment[], duration = 60) =>
  runDetectors([new AvSync()], makeSamples({ duration, base: { ...STEADY, ...SYNCED }, segments }));

// PRD §12.3, problem 8.
describe("Audio / video out of sync", () => {
  it("opens after 3 samples beyond 200 ms, ends at the first of 3 within 120 ms", () => {
    const { problems, sent } = run([recorded(12, JUMP), { from: 35, to: 61, values: { av_offset: 60, v_jb: 979, a_jb: 900 } }]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      type: "av_sync",
      title: "Audio / video out of sync",
      category: "Device",
      severity: "warn",
      tStart: 12,
      tEnd: 28,
      open: false,
      oneLine: "audio ahead by 335 ms",
    });
    expect(problems[0].card.rows).toEqual([
      ["Offset", "audio ahead by 335 ms"],
      ["Video jitter buffer / Audio jitter buffer", "979 / 601 ms"],
      ["Video delay", "991 ms"],
    ]);
    expect(problems[0].card.likelyCause).toBe("The video jitter buffer grew to 981 ms while the other stayed at 85 ms.");
    expect(problems[0].card.check).toBe("If it started after a freeze or a layer change — recovers on its own; if constant — sender timestamps.");
    expect(problems[0].card.series.name).toBe("av_offset");
    expect(sent[0]).toMatchObject({ tStart: 12, open: true, oneLine: "audio ahead by 790 ms" });
  });

  it("says audio behind when the audio plays later, and blames the audio buffer", () => {
    const { problems } = run([recorded(12, JUMP, -1), { from: 35, to: 61, values: { av_offset: -60 } }]);

    expect(problems[0]).toMatchObject({ tStart: 12, tEnd: 28, oneLine: "audio behind by 335 ms" });
    expect(problems[0].card.likelyCause).toBe("The audio jitter buffer grew to 981 ms while the other stayed at 85 ms.");
  });

  it("stays silent without both playout timestamps, whatever the buffers", () => {
    const { problems } = run([{ from: 10, to: 61, values: { av_offset: null, v_jb: 400, a_jb: 40 } }]);

    expect(problems).toEqual([]);
  });

  it("needs 3 samples in a row beyond 200 ms; ends when the timestamps are gone", () => {
    expect(run([{ from: 20, to: 22, values: { av_offset: 450 } }]).problems).toEqual([]);

    const { problems } = run([
      { from: 20, to: 30, values: { av_offset: -450 } },
      { from: 30, to: 61, values: { av_offset: null } },
    ]);
    expect(problems).toEqual([expect.objectContaining({ tStart: 20, tEnd: 30, oneLine: "audio behind by 450 ms" })]);
  });
});
