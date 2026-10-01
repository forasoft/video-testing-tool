import { describe, expect, it } from "vitest";
import { VIDEO_CODECS } from "shared/constants/sampleFields";
import { BandwidthDrop } from "src/session/problems/bandwidthDrop";
import { Blurry } from "src/session/problems/blurry";
import { makeSamples, runDetectors, Segment, STEADY, Values } from "./makeSamples";

const NS = " ";
const VP8 = VIDEO_CODECS.indexOf("VP8");
const AV1 = VIDEO_CODECS.indexOf("AV1");
const H265 = VIDEO_CODECS.indexOf("H265");

// A sharp 720p VP8 call.
const SHARP: Values = { v_codec_id: VP8, v_qp: 20 };
// The stand's Blurry preset: 1080p capped at 250 kbps with the resolution kept; no QP in the first seconds.
const BLURRY = (qp: number | null): Segment[] => [
  { from: 0, to: 81, values: { v_qp: qp, v_bitrate: (t) => 240 + (t % 3) * 5, v_w: 1920, v_h: 1080 } },
  { from: 0, to: 2, values: { v_qp: null, v_bitrate: null } },
];

const samplesOf = (segments: Segment[], base: Values = {}, duration = 80) =>
  makeSamples({ duration, base: { ...STEADY, ...SHARP, ...base }, segments });

const run = (segments: Segment[], base: Values = {}) => runDetectors([new Blurry()], samplesOf(segments, base));

// PRD §12.3, problem 9.
describe("Blurry picture", () => {
  it("opens after 5 samples of bad QP at a steady bitrate, with the codec's threshold", () => {
    const { problems, sent } = run(BLURRY(106));

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      type: "blurry",
      title: "Blurry picture",
      category: "Sender",
      severity: "warn",
      tStart: 2,
      tEnd: null,
      open: true,
      oneLine: "QP 106 at 1080p, bitrate 245 kbps",
    });
    expect(problems[0].card.rows).toEqual([
      ["QP", "106 (VP8, bad above 80)"],
      ["Bitrate", "245 kbps at 1920×1080"],
      ["Layer", "1080p"],
    ]);
    expect(problems[0].card.likelyCause).toBe("The sender encodes 1920×1080 at only 245 kbps — too little for this resolution.");
    expect(problems[0].card.check).toBe("Sender's encoder settings or SFU layer selection; the network is fine.");
    expect(problems[0].card.series.name).toBe("v_qp");
    // Known after 5 samples: 2…6 s.
    const { points } = sent[0].card.series;
    expect(sent[0]).toMatchObject({ tStart: 2, open: true });
    expect(points[points.length - 1][0]).toBe(6);
  });

  it("uses the thresholds of the codec: AV1 is bad above 160", () => {
    expect(run(BLURRY(150), { v_codec_id: AV1 }).problems).toEqual([]);

    const { problems } = run(BLURRY(205), { v_codec_id: AV1 });
    expect(problems[0].card.rows[0]).toEqual(["QP", "205 (AV1, bad above 160)"]);
    expect(problems[0].oneLine).toBe("QP 205 at 1080p, bitrate 245 kbps");
  });

  it("is not blurry while the bitrate is under 80 % of its median, nor while a Bandwidth drop goes on", () => {
    expect(run([{ from: 30, to: 42, values: { v_qp: 106, v_bitrate: 600 } }]).problems).toEqual([]);

    // A long drop pulls the 30-s median down: after ~15 s the low bitrate is "80 % of the median" again.
    const drop: Segment = { from: 30, to: 70, values: { v_qp: 106, v_bitrate: 600, v_loss: 4 } };
    expect(run([drop]).problems).toEqual([expect.objectContaining({ type: "blurry", tStart: 46 })]);
    const { problems } = runDetectors([new BandwidthDrop(), new Blurry()], samplesOf([drop]));
    expect(problems.map((p) => p.type)).toEqual(["bandwidth_drop"]);
  });

  it("ends at the first of 5 samples with QP out of the bad zone", () => {
    const { problems } = run([
      { from: 30, to: 50, values: { v_qp: 100 } },
      { from: 52, to: 53, values: { v_qp: 90 } },
    ]);

    expect(problems).toEqual([expect.objectContaining({ tStart: 30, tEnd: 53, open: false, oneLine: `QP 100 at 720p, bitrate 1${NS}500 kbps` })]);
  });

  it("stays silent without QP or without thresholds for the codec", () => {
    expect(run(BLURRY(null)).problems).toEqual([]);
    expect(run(BLURRY(106), { v_codec_id: H265 }).problems).toEqual([]);
    expect(run(BLURRY(106), { v_codec_id: null }).problems).toEqual([]);
  });
});
