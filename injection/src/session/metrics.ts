// (previous snapshot, current snapshot) → per-second sample values. Formulas — PRD §7.
import {
  CANDIDATE_TYPES,
  ENCODER_KINDS,
  PROTOCOLS,
  QUALITY_LIMITS,
  SAMPLE_FIELDS,
  SampleValues,
  VIDEO_CODECS,
} from "shared/constants/sampleFields";
import { RtpStats, Snapshot } from "./extract";

export const WINDOW_S = 5;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const times = (value: unknown, factor: number): number | null => {
  const n = num(value);
  return n === null ? null : n * factor;
};

// Δ of a cumulative counter. null when either value is missing or the counter went
// down (a new SSRC restarted it).
export const delta = (
  cur: RtpStats | undefined,
  prev: RtpStats | undefined,
  key: string
): number | null => {
  const a = num(cur?.[key]);
  const b = num(prev?.[key]);
  if (a === null || b === null || a < b) {
    return null;
  }
  return a - b;
};

// Same stream in both snapshots: otherwise every Δ is meaningless.
const sameStream = (cur?: RtpStats, prev?: RtpStats): boolean =>
  Boolean(cur && prev && cur.ssrc === prev.ssrc);

// Δ of a counter of the same stream.
const streamDelta = (cur: RtpStats | undefined, prev: RtpStats | undefined, key: string) =>
  sameStream(cur, prev) ? delta(cur, prev, key) : null;

// Δ key / Δ time in seconds.
export const perSecond = (
  cur: RtpStats | undefined,
  prev: RtpStats | undefined,
  key: string
): number | null => {
  const d = streamDelta(cur, prev, key);
  const ms = streamDelta(cur, prev, "timestamp");
  return d === null || !ms ? null : (d * 1000) / ms;
};

// Δ numerator / Δ denominator × scale; null when the denominator did not grow.
export const perItem = (
  cur: RtpStats | undefined,
  prev: RtpStats | undefined,
  numerator: string,
  denominator: string,
  scale = 1
): number | null => {
  const a = streamDelta(cur, prev, numerator);
  const b = streamDelta(cur, prev, denominator);
  return a === null || !b ? null : (a / b) * scale;
};

// bytes Δ × 8 / Δt(ms) = kbit/s
export const bitrateKbps = (cur?: RtpStats, prev?: RtpStats): number | null => {
  const bytesPerSecond = perSecond(cur, prev, "bytesReceived");
  return bytesPerSecond === null ? null : (bytesPerSecond * 8) / 1000;
};

// Σ numerator / Σ denominator × 100 over the last 5 samples. A sample without data
// (new SSRC, missing counters) restarts the window.
export class WindowPct {
  entries: { part: number; total: number }[] = [];

  reset(): null {
    this.entries = [];
    return null;
  }

  push(part: number, total: number): number | null {
    this.entries.push({ part, total });
    if (this.entries.length > WINDOW_S) {
      this.entries.shift();
    }

    const sumPart = this.entries.reduce((sum, e) => sum + e.part, 0);
    const sumTotal = this.entries.reduce((sum, e) => sum + e.total, 0);
    return sumTotal > 0 ? Math.max(0, (sumPart / sumTotal) * 100) : null;
  }
}

// packetsLost Δ / (packetsLost Δ + packetsReceived Δ) × 100, window 5 s.
// packetsLost may go down a little without a new SSRC (late packets are no longer
// counted as lost), so a negative Δ is kept and only the total is clamped at 0.
export const pushLoss = (window: WindowPct, cur?: RtpStats, prev?: RtpStats): number | null => {
  const received = streamDelta(cur, prev, "packetsReceived");
  const lostCur = num(cur?.packetsLost);
  const lostPrev = num(prev?.packetsLost);

  if (received === null || lostCur === null || lostPrev === null) {
    return window.reset();
  }
  const lost = lostCur - lostPrev;
  return window.push(lost, lost + received);
};

// concealedSamples Δ / totalSamplesReceived Δ × 100, window 5 s.
export const pushConcealed = (window: WindowPct, cur?: RtpStats, prev?: RtpStats): number | null => {
  const concealed = streamDelta(cur, prev, "concealedSamples");
  const total = streamDelta(cur, prev, "totalSamplesReceived");

  if (concealed === null || total === null) {
    return window.reset();
  }
  return window.push(concealed, total);
};

const indexOf = (list: readonly string[], value: unknown): number | null => {
  if (typeof value !== "string") {
    return null;
  }
  const index = list.findIndex((item) => item.toLowerCase() === value.toLowerCase());
  return index === -1 ? null : index;
};

// The type the connection chip shows: the remote candidate if it is relay, else the local one.
export const pathType = (local?: RtpStats, remote?: RtpStats): string | undefined => {
  if (remote?.candidateType === "relay") {
    return "relay";
  }
  return local?.candidateType as string | undefined;
};

// Protocol between this browser and the next hop: relayProtocol for a relay candidate.
export const pathProtocol = (local?: RtpStats): string | undefined =>
  (local?.relayProtocol ?? local?.protocol) as string | undefined;

export const codecName = (codec?: RtpStats): string | undefined =>
  typeof codec?.mimeType === "string" ? codec.mimeType.split("/")[1] : undefined;

// Frames the video element dropped (getVideoPlaybackQuality), or the receiver's
// framesDropped when the element does not report them.
const droppedFrames = (cur: Snapshot, prev?: Snapshot): number | null => {
  const a = cur.element?.droppedFrames;
  const b = prev?.element?.droppedFrames;
  if (a != null && b != null) {
    return a >= b ? a - b : null;
  }
  return streamDelta(cur.video, prev?.video, "framesDropped");
};

// Time from the end of decoding to the frame being shown. rVFC receiveTime is the arrival
// of the frame's last packet, so presentationTime − receiveTime already holds the jitter
// buffer minus the frame assembly time (first → last packet) and the decode time.
export const renderDelay = (
  frames: Snapshot["frames"],
  jitterBuffer: number | null,
  assembly: number | null,
  decode: number | null
): number | null => {
  if (!frames || !frames.fps) {
    return null;
  }
  if (frames.latency === null) {
    // The browser gives no receiveTime.
    return 0;
  }
  if (jitterBuffer === null) {
    return null;
  }
  return Math.max(0, frames.latency - (jitterBuffer - (assembly ?? 0)) - (decode ?? 0));
};

const sumOrNull = (required: number | null, ...optional: (number | null)[]): number | null =>
  required === null ? null : optional.reduce((sum: number, value) => sum + (value ?? 0), required);

// Σ of the values that are there; null when none is.
const sumKnown = (values: (number | null)[]): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
};

const pixels = (layer: RtpStats): number => (num(layer.frameWidth) ?? 0) * (num(layer.frameHeight) ?? 0);

// The largest layer of the outgoing video that is being sent.
export const topLayer = (layers: RtpStats[] = []): RtpStats | undefined => layers
  .filter((layer) => layer.active !== false && pixels(layer) > 0)
  .reduce<RtpStats | undefined>((top, layer) => (!top || pixels(layer) > pixels(top) ? layer : top), undefined);

// The outgoing video (PRD §6.3): kbps sent over all layers, the encoder's target over all layers, and
// the size, rate and quality limitation of the top layer (the limitation is the sender's, one for all layers).
export const outgoing = (cur: RtpStats[] = [], prev: RtpStats[] = []): Pick<SampleValues,
  "out_bitrate" | "out_target" | "out_w" | "out_h" | "out_fps" | "out_limit" | "out_encoder"> => {
  const top = topLayer(cur);
  const main = top ?? cur[0];
  const efficient = main?.powerEfficientEncoder;
  return {
    out_bitrate: sumKnown(cur.map((layer) => {
      const bytesPerSecond = perSecond(layer, prev.find((p) => p.id === layer.id), "bytesSent");
      return bytesPerSecond === null ? null : (bytesPerSecond * 8) / 1000;
    })),
    out_target: sumKnown(cur.map((layer) => times(layer.targetBitrate, 1 / 1000))),
    out_w: top ? num(top.frameWidth) : null,
    out_h: top ? num(top.frameHeight) : null,
    out_fps: top ? num(top.framesPerSecond) : null,
    out_limit: indexOf(QUALITY_LIMITS, main?.qualityLimitationReason),
    out_encoder: typeof efficient === "boolean" ? ENCODER_KINDS.indexOf(efficient ? "hardware" : "software") : null,
  };
};

export const emptySample = (): SampleValues => {
  const sample = {} as SampleValues;
  SAMPLE_FIELDS.forEach((field) => {
    sample[field] = null;
  });
  return sample;
};

// Keeps the previous snapshot and the sliding windows between calls.
export class Metrics {
  prev: Snapshot | undefined;
  videoLoss = new WindowPct();
  audioLoss = new WindowPct();
  concealed = new WindowPct();
  pairId: string | undefined;
  pairChanges = 0;

  next(cur: Snapshot, t: number): SampleValues {
    const prev = this.prev;
    const s = emptySample();
    const { video, audio, pair, local, remote, element } = cur;
    const pv = prev?.video;
    const pa = prev?.audio;

    s.t = t;

    s.v_bitrate = bitrateKbps(video, pv);
    s.v_fps_r = cur.frames ? cur.frames.fps : null;
    s.v_fps_dec = perSecond(video, pv, "framesDecoded");
    s.v_fps_recv = perSecond(video, pv, "framesReceived");
    s.v_w = element && element.videoWidth > 0 ? element.videoWidth : null;
    s.v_h = element && element.videoHeight > 0 ? element.videoHeight : null;
    s.v_loss = pushLoss(this.videoLoss, video, pv);
    s.v_jitter = times(video?.jitter, 1000);
    s.v_nack = streamDelta(video, pv, "nackCount");
    s.v_pli = streamDelta(video, pv, "pliCount");
    s.v_qp = perItem(video, pv, "qpSum", "framesDecoded");
    s.v_frames_dropped = droppedFrames(cur, prev);
    s.v_discarded = streamDelta(video, pv, "packetsDiscarded");
    s.v_freeze_cnt = streamDelta(video, pv, "freezeCount");
    s.v_freeze_ms = times(streamDelta(video, pv, "totalFreezesDuration"), 1000);
    s.v_freeze_pct = cur.frames && cur.frames.sessionMs > 0
      ? (cur.frames.freezeMs / cur.frames.sessionMs) * 100
      : null;
    s.hidden = cur.frames ? cur.frames.hidden : null;
    s.longtask_max = cur.longTasks ? cur.longTasks.max : null;
    s.longtask_sum = cur.longTasks ? cur.longTasks.sum : null;
    s.v_jb = perItem(video, pv, "jitterBufferDelay", "jitterBufferEmittedCount", 1000);
    s.v_decode = perItem(video, pv, "totalDecodeTime", "framesDecoded", 1000);
    s.v_render = renderDelay(
      cur.frames,
      s.v_jb,
      perItem(video, pv, "totalAssemblyTime", "framesDecoded", 1000),
      s.v_decode
    );
    s.v_playout_ts = num(video?.estimatedPlayoutTimestamp);
    s.v_codec_id = indexOf(VIDEO_CODECS, codecName(cur.videoCodec));

    s.a_bitrate = bitrateKbps(audio, pa);
    s.a_loss = pushLoss(this.audioLoss, audio, pa);
    s.a_jitter = times(audio?.jitter, 1000);
    s.a_jb = perItem(audio, pa, "jitterBufferDelay", "jitterBufferEmittedCount", 1000);
    s.a_concealed_pct = pushConcealed(this.concealed, audio, pa);
    s.a_playout_ts = num(audio?.estimatedPlayoutTimestamp);

    s.av_offset = s.a_playout_ts === null || s.v_playout_ts === null
      ? null
      : s.a_playout_ts - s.v_playout_ts;

    s.rtt = times(pair?.currentRoundTripTime, 1000);
    s.avail_in = times(pair?.availableIncomingBitrate, 1 / 1000);
    s.pair_type = indexOf(CANDIDATE_TYPES, pathType(local, remote));
    s.pair_proto = indexOf(PROTOCOLS, pathProtocol(local));
    s.pair_changes = this.countPairChanges(cur);

    Object.assign(s, outgoing(cur.outbound, prev?.outbound));

    s.d_net = times(s.rtt, 0.5);
    s.d_jb = s.v_jb;
    s.d_decode = s.v_decode;
    s.d_render = s.v_render ?? 0;
    s.d_video = sumOrNull(s.d_jb, s.d_net, s.d_decode, s.d_render);
    s.d_audio = sumOrNull(s.a_jb, s.d_net);

    this.prev = cur;
    return s;
  }

  // Cumulative number of selected-pair changes: the transport's own counter, or
  // changes of the selected pair seen by this session when the browser has none.
  countPairChanges({ transport, pair }: Snapshot): number | null {
    const reported = num(transport?.selectedCandidatePairChanges);
    if (reported !== null) {
      return reported;
    }
    if (!pair) {
      return null;
    }
    if (this.pairId !== undefined && this.pairId !== pair.id) {
      this.pairChanges += 1;
    }
    this.pairId = pair.id;
    return this.pairChanges;
  }
}
