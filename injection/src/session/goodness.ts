// Fixed thresholds of PRD §7: good — green, moderate — yellow, bad — red.
import { CANDIDATE_TYPES, PROTOCOLS, SampleValues, VIDEO_CODECS } from "shared/constants/sampleFields";
import { Goodness, GoodnessMap } from "shared/protocol";
import { ElementInfo } from "./extract";

// Higher is better: ≥ good → good, ≥ moderate → moderate, lower → bad.
const higher = (value: number, good: number, moderate: number): Goodness => {
  if (value >= good) {
    return "good";
  }
  return value >= moderate ? "moderate" : "bad";
};

// Lower is better: < good → good, ≤ bad → moderate, above → bad.
const lower = (value: number, good: number, bad: number): Goodness => {
  if (value < good) {
    return "good";
  }
  return value <= bad ? "moderate" : "bad";
};

// Frame rate: ≥ 24 good, 15–24 moderate, < 15 bad.
export const fpsGoodness = (fps: number): Goodness => higher(fps, 24, 15);

// Bitrate by frame height: [below height, good from, moderate from] in kbps.
const BITRATE = [
  [480, 700, 200],
  [720, 1200, 400],
  [1080, 2000, 500],
  [Infinity, 2000, 1000],
];

const bitrateRow = (height: number | null): number[] => BITRATE.find(([below]) => (height ?? 0) < below) as number[];

export const bitrateGoodness = (kbps: number, height: number | null): Goodness => {
  const [, good, moderate] = bitrateRow(height);
  return higher(kbps, good, moderate);
};

// The good bitrate for a frame height, kbps: the Report's target (PRD §13.3).
export const bitrateTarget = (height: number | null): number => bitrateRow(height)[1];

// Resolution against the element: good if not smaller than element / 1.2 on both sides,
// bad if smaller than element / 2.4 on any side.
export const resolutionGoodness = (
  width: number,
  height: number,
  element: Pick<ElementInfo, "clientWidth" | "clientHeight">
): Goodness => {
  if (width < element.clientWidth / 2.4 || height < element.clientHeight / 2.4) {
    return "bad";
  }
  if (width >= element.clientWidth / 1.2 && height >= element.clientHeight / 1.2) {
    return "good";
  }
  return "moderate";
};

// Packet loss, %: < 1, 1–5, > 5.
export const lossGoodness = (pct: number): Goodness => lower(pct, 1, 5);

// Video and audio delay, ms: < 300, 300–1000, > 1000.
export const delayGoodness = (ms: number): Goodness => lower(ms, 300, 1000);

// Freezes & Stalls, %: < 1, 1–10, > 10.
export const freezesGoodness = (pct: number): Goodness => lower(pct, 1, 10);

// RTT, ms: < 150, 150–300, > 300.
export const rttGoodness = (ms: number): Goodness => lower(ms, 150, 300);

// Connection path: host / srflx / prflx good, relay over udp moderate, relay over tcp or tls bad.
export const pathGoodness = (type: string, protocol: string | null): Goodness => {
  if (type !== "relay") {
    return "good";
  }
  return protocol === "tcp" || protocol === "tls" ? "bad" : "moderate";
};

// A/V offset, ms by absolute value: < 100, 100–200, > 200.
export const avOffsetGoodness = (ms: number): Goodness => lower(Math.abs(ms), 100, 200);

// QP by codec: [good up to, moderate up to].
const QP: Record<string, [number, number]> = {
  H264: [30, 38],
  VP8: [50, 80],
  VP9: [100, 160],
  AV1: [100, 160],
};

export const qpThresholds = (codec: string): [number, number] | undefined => QP[codec];

export const qpGoodness = (qp: number, codec: string): Goodness | undefined => {
  const thresholds = qpThresholds(codec);
  if (!thresholds) {
    return undefined;
  }
  const [good, moderate] = thresholds;
  if (qp <= good) {
    return "good";
  }
  return qp <= moderate ? "moderate" : "bad";
};

// Audio concealment, %: < 1, 1–5, > 5.
export const concealmentGoodness = (pct: number): Goodness => lower(pct, 1, 5);

// First frame from the stream's start, s: < 4, 4–8, > 8 — the limits of Slow start (PRD §13.3, §12.3).
export const firstFrameGoodness = (s: number): Goodness => lower(s, 4, 8);

// Goodness of every metric that has a value in the sample.
export const sampleGoodness = (
  s: SampleValues,
  element?: Pick<ElementInfo, "clientWidth" | "clientHeight">
): GoodnessMap => {
  const g: GoodnessMap = {};

  if (s.v_fps_r !== null) {
    g.fps = fpsGoodness(s.v_fps_r);
  }
  if (s.v_bitrate !== null) {
    g.bitrate = bitrateGoodness(s.v_bitrate, s.v_h);
  }
  if (s.v_w !== null && s.v_h !== null && element) {
    g.resolution = resolutionGoodness(s.v_w, s.v_h, element);
  }
  if (s.v_loss !== null) {
    g.loss = lossGoodness(s.v_loss);
  }
  if (s.d_video !== null) {
    g.videoDelay = delayGoodness(s.d_video);
  }
  if (s.d_audio !== null) {
    g.audioDelay = delayGoodness(s.d_audio);
  }
  if (s.v_freeze_pct !== null) {
    g.freezes = freezesGoodness(s.v_freeze_pct);
  }
  if (s.rtt !== null) {
    g.rtt = rttGoodness(s.rtt);
  }
  if (s.pair_type !== null) {
    g.path = pathGoodness(
      CANDIDATE_TYPES[s.pair_type],
      s.pair_proto === null ? null : PROTOCOLS[s.pair_proto]
    );
  }
  if (s.av_offset !== null) {
    g.avOffset = avOffsetGoodness(s.av_offset);
  }
  if (s.v_qp !== null && s.v_codec_id !== null) {
    const qp = qpGoodness(s.v_qp, VIDEO_CODECS[s.v_codec_id]);
    if (qp) {
      g.qp = qp;
    }
  }
  if (s.a_concealed_pct !== null) {
    g.concealment = concealmentGoodness(s.a_concealed_pct);
  }

  return g;
};
