import { describe, expect, it } from "vitest";
import { CANDIDATE_TYPES, PROTOCOLS, VIDEO_CODECS } from "shared/constants/sampleFields";
import {
  avOffsetGoodness,
  bitrateGoodness,
  concealmentGoodness,
  delayGoodness,
  fpsGoodness,
  freezesGoodness,
  lossGoodness,
  pathGoodness,
  qpGoodness,
  resolutionGoodness,
  rttGoodness,
  sampleGoodness,
} from "src/session/goodness";
import { emptySample } from "src/session/metrics";

describe("thresholds of PRD §7", () => {
  it("frame rate: ≥ 24 good, 15–24 moderate, < 15 bad", () => {
    expect(fpsGoodness(30)).toBe("good");
    expect(fpsGoodness(24)).toBe("good");
    expect(fpsGoodness(23.9)).toBe("moderate");
    expect(fpsGoodness(15)).toBe("moderate");
    expect(fpsGoodness(14.9)).toBe("bad");
  });

  it("bitrate depends on the frame height", () => {
    // < 480p: ≥ 700 good, 200–700 moderate
    expect(bitrateGoodness(700, 360)).toBe("good");
    expect(bitrateGoodness(699, 360)).toBe("moderate");
    expect(bitrateGoodness(200, 360)).toBe("moderate");
    expect(bitrateGoodness(199, 360)).toBe("bad");
    // < 720p: ≥ 1200, 400–1200
    expect(bitrateGoodness(1200, 540)).toBe("good");
    expect(bitrateGoodness(400, 540)).toBe("moderate");
    expect(bitrateGoodness(399, 540)).toBe("bad");
    // < 1080p: ≥ 2000, 500–2000
    expect(bitrateGoodness(1999, 720)).toBe("moderate");
    expect(bitrateGoodness(2000, 720)).toBe("good");
    expect(bitrateGoodness(499, 720)).toBe("bad");
    // ≥ 1080p: ≥ 2000, 1000–2000
    expect(bitrateGoodness(2000, 1080)).toBe("good");
    expect(bitrateGoodness(1000, 1080)).toBe("moderate");
    expect(bitrateGoodness(999, 1080)).toBe("bad");
    // No frame yet: the lowest band.
    expect(bitrateGoodness(700, null)).toBe("good");
  });

  it("resolution against the element size", () => {
    const element = { clientWidth: 640, clientHeight: 360 };
    expect(resolutionGoodness(1280, 720, element)).toBe("good");
    expect(resolutionGoodness(640, 360, element)).toBe("good");
    expect(resolutionGoodness(534, 300, element)).toBe("good");
    expect(resolutionGoodness(480, 270, element)).toBe("moderate");
    expect(resolutionGoodness(320, 180, element)).toBe("moderate");
    expect(resolutionGoodness(240, 135, element)).toBe("bad");
    expect(resolutionGoodness(640, 140, element)).toBe("bad");
  });

  it("packet loss: < 1 good, 1–5 moderate, > 5 bad", () => {
    expect(lossGoodness(0.99)).toBe("good");
    expect(lossGoodness(1)).toBe("moderate");
    expect(lossGoodness(5)).toBe("moderate");
    expect(lossGoodness(5.01)).toBe("bad");
  });

  it("delay: < 300 good, 300–1000 moderate, > 1000 bad", () => {
    expect(delayGoodness(299)).toBe("good");
    expect(delayGoodness(300)).toBe("moderate");
    expect(delayGoodness(1000)).toBe("moderate");
    expect(delayGoodness(1001)).toBe("bad");
  });

  it("freezes: < 1 good, 1–10 moderate, > 10 bad", () => {
    expect(freezesGoodness(0.5)).toBe("good");
    expect(freezesGoodness(1)).toBe("moderate");
    expect(freezesGoodness(10)).toBe("moderate");
    expect(freezesGoodness(10.2)).toBe("bad");
  });

  it("RTT: < 150 good, 150–300 moderate, > 300 bad", () => {
    expect(rttGoodness(92)).toBe("good");
    expect(rttGoodness(150)).toBe("moderate");
    expect(rttGoodness(301)).toBe("bad");
  });

  it("path: direct good, relay over udp moderate, relay over tcp or tls bad", () => {
    expect(pathGoodness("host", "udp")).toBe("good");
    expect(pathGoodness("srflx", "tcp")).toBe("good");
    expect(pathGoodness("prflx", "udp")).toBe("good");
    expect(pathGoodness("relay", "udp")).toBe("moderate");
    expect(pathGoodness("relay", "tcp")).toBe("bad");
    expect(pathGoodness("relay", "tls")).toBe("bad");
  });

  it("A/V offset by absolute value: < 100, 100–200, > 200", () => {
    expect(avOffsetGoodness(-17)).toBe("good");
    expect(avOffsetGoodness(-150)).toBe("moderate");
    expect(avOffsetGoodness(201)).toBe("bad");
  });

  it("QP by codec", () => {
    expect(qpGoodness(30, "H264")).toBe("good");
    expect(qpGoodness(31, "H264")).toBe("moderate");
    expect(qpGoodness(39, "H264")).toBe("bad");
    expect(qpGoodness(50, "VP8")).toBe("good");
    expect(qpGoodness(80, "VP8")).toBe("moderate");
    expect(qpGoodness(81, "VP8")).toBe("bad");
    expect(qpGoodness(100, "VP9")).toBe("good");
    expect(qpGoodness(160, "AV1")).toBe("moderate");
    expect(qpGoodness(161, "AV1")).toBe("bad");
    expect(qpGoodness(10, "H265")).toBeUndefined();
  });

  it("audio concealment: < 1 good, 1–5 moderate, > 5 bad", () => {
    expect(concealmentGoodness(0.2)).toBe("good");
    expect(concealmentGoodness(1.8)).toBe("moderate");
    expect(concealmentGoodness(5.5)).toBe("bad");
  });
});

describe("sampleGoodness", () => {
  it("rates only the metrics that have a value", () => {
    expect(sampleGoodness(emptySample())).toEqual({});
  });

  it("rates every metric of a full sample", () => {
    const s = {
      ...emptySample(),
      v_fps_r: 15,
      v_bitrate: 1546,
      v_w: 1280,
      v_h: 720,
      v_loss: 0.21,
      d_video: 138,
      d_audio: 1200,
      v_freeze_pct: 2.1,
      rtt: 92,
      pair_type: CANDIDATE_TYPES.indexOf("relay"),
      pair_proto: PROTOCOLS.indexOf("tcp"),
      av_offset: 17,
      v_qp: 29,
      v_codec_id: VIDEO_CODECS.indexOf("H264"),
      a_concealed_pct: 1.8,
    };

    expect(sampleGoodness(s, { clientWidth: 640, clientHeight: 360 })).toEqual({
      fps: "moderate",
      bitrate: "moderate",
      resolution: "good",
      loss: "good",
      videoDelay: "good",
      audioDelay: "bad",
      freezes: "moderate",
      rtt: "good",
      path: "bad",
      avOffset: "good",
      qp: "good",
      concealment: "moderate",
    });
  });
});
