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

// Loss and concealment are counted over the last this many samples, that is seconds.
export const WINDOW_S = 5;

// A finite number from a report field, else null.
const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

// A report field times a factor — a unit change, e.g. s → ms; null without the field.
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
const perSecond = (
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

  // Starts the window over; returns the null that a sample without data shows.
  reset(): null {
    this.entries = [];
    return null;
  }

  // Adds a sample's part and total: the window's share, %, clamped at 0; null while its total is 0.
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
const pushConcealed = (window: WindowPct, cur?: RtpStats, prev?: RtpStats): number | null => {
  const concealed = streamDelta(cur, prev, "concealedSamples");
  const total = streamDelta(cur, prev, "totalSamplesReceived");

  if (concealed === null || total === null) {
    return window.reset();
  }
  return window.push(concealed, total);
};

// The index of a categorical value in its list, case-insensitive, as the sample stores it; null when not listed.
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

// `VP8` from the codec's mimeType `video/VP8`; undefined without a codec report.
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
  if (!frames?.fps) {
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

// The required part plus the optional ones (a missing one counts as 0); null without the required part.
const sumOrNull = (required: number | null, ...optional: (number | null)[]): number | null =>
  required === null ? null : optional.reduce((sum: number, value) => sum + (value ?? 0), required);

// Σ of the values that are there; null when none is.
const sumKnown = (values: (number | null)[]): number | null => {
  const known = values.filter((value): value is number => value !== null);
  return known.length ? known.reduce((sum, value) => sum + value, 0) : null;
};

// A layer's frame area, px; 0 when its size is not reported.
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
  // Without a top layer — the first one; with no outgoing video there is none.
  const main = top ?? (cur.length > 0 ? cur[0] : undefined);
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

// A sample with every field null: the base of each sample, and all of a second without data.
export const emptySample = (): SampleValues => {
  const sample = {} as SampleValues;
  SAMPLE_FIELDS.forEach((field) => {
    sample[field] = null;
  });
  return sample;
};

// What the page counts itself: frame rate and freezes from rVFC, the hidden share, long tasks.
const pageValues = ({ frames, longTasks }: Snapshot): Partial<SampleValues> => ({
  v_fps_r: frames ? frames.fps : null,
  v_freeze_pct: frames && frames.sessionMs > 0 ? (frames.freezeMs / frames.sessionMs) * 100 : null,
  hidden: frames ? frames.hidden : null,
  longtask_max: longTasks ? longTasks.max : null,
  longtask_sum: longTasks ? longTasks.sum : null,
});

// The parts of the video and audio delay (PRD §7): network — half the RTT, jitter buffer, decode, render.
const delays = (s: SampleValues): Partial<SampleValues> => {
  const net = times(s.rtt, 0.5);
  const render = s.v_render ?? 0;
  return {
    d_net: net,
    d_jb: s.v_jb,
    d_decode: s.v_decode,
    d_render: render,
    d_video: sumOrNull(s.v_jb, net, s.v_decode, render),
    d_audio: sumOrNull(s.a_jb, net),
  };
};

// Keeps the previous snapshot and the sliding windows between calls.
export class Metrics {
  prev: Snapshot | undefined;
  videoLoss = new WindowPct();
  audioLoss = new WindowPct();
  concealed = new WindowPct();
  // The pair seen last and its changes, counted here when the transport has no counter (countPairChanges).
  pairId: string | undefined;
  pairChanges = 0;

  // The sample of second `t` from this snapshot and the previous one (PRD §6.3, formulas §7).
  next(cur: Snapshot, t: number): SampleValues {
    const s: SampleValues = {
      ...emptySample(),
      t,
      ...this.video(cur),
      ...pageValues(cur),
      ...this.audio(cur),
      ...this.path(cur),
      ...outgoing(cur.outbound, this.prev?.outbound),
    };
    s.av_offset = s.a_playout_ts === null || s.v_playout_ts === null ? null : s.a_playout_ts - s.v_playout_ts;
    Object.assign(s, delays(s));
    this.prev = cur;
    return s;
  }

  // The received video: rates, size, losses, the decoder's counters and its part of the delay.
  private video(cur: Snapshot): Partial<SampleValues> {
    const { video, element } = cur;
    const pv = this.prev?.video;
    const jitterBuffer = perItem(video, pv, "jitterBufferDelay", "jitterBufferEmittedCount", 1000);
    const decode = perItem(video, pv, "totalDecodeTime", "framesDecoded", 1000);
    const assembly = perItem(video, pv, "totalAssemblyTime", "framesDecoded", 1000);
    return {
      v_bitrate: bitrateKbps(video, pv),
      v_fps_dec: perSecond(video, pv, "framesDecoded"),
      v_fps_recv: perSecond(video, pv, "framesReceived"),
      v_w: element && element.videoWidth > 0 ? element.videoWidth : null,
      v_h: element && element.videoHeight > 0 ? element.videoHeight : null,
      v_loss: pushLoss(this.videoLoss, video, pv),
      v_jitter: times(video?.jitter, 1000),
      v_nack: streamDelta(video, pv, "nackCount"),
      v_pli: streamDelta(video, pv, "pliCount"),
      v_qp: perItem(video, pv, "qpSum", "framesDecoded"),
      v_frames_dropped: droppedFrames(cur, this.prev),
      v_discarded: streamDelta(video, pv, "packetsDiscarded"),
      v_freeze_cnt: streamDelta(video, pv, "freezeCount"),
      v_freeze_ms: times(streamDelta(video, pv, "totalFreezesDuration"), 1000),
      v_jb: jitterBuffer,
      v_decode: decode,
      v_render: renderDelay(cur.frames, jitterBuffer, assembly, decode),
      v_playout_ts: num(video?.estimatedPlayoutTimestamp),
      v_codec_id: indexOf(VIDEO_CODECS, codecName(cur.videoCodec)),
    };
  }

  // The received audio: rate, losses, jitter buffer, concealment and its playout time for the A/V offset.
  private audio(cur: Snapshot): Partial<SampleValues> {
    const { audio } = cur;
    const pa = this.prev?.audio;
    return {
      a_bitrate: bitrateKbps(audio, pa),
      a_loss: pushLoss(this.audioLoss, audio, pa),
      a_jitter: times(audio?.jitter, 1000),
      a_jb: perItem(audio, pa, "jitterBufferDelay", "jitterBufferEmittedCount", 1000),
      a_concealed_pct: pushConcealed(this.concealed, audio, pa),
      a_playout_ts: num(audio?.estimatedPlayoutTimestamp),
    };
  }

  // The selected candidate pair: RTT, incoming bandwidth, the path and how many times it changed.
  private path(cur: Snapshot): Partial<SampleValues> {
    const { pair, local, remote } = cur;
    return {
      rtt: times(pair?.currentRoundTripTime, 1000),
      avail_in: times(pair?.availableIncomingBitrate, 1 / 1000),
      pair_type: indexOf(CANDIDATE_TYPES, pathType(local, remote)),
      pair_proto: indexOf(PROTOCOLS, pathProtocol(local)),
      pair_changes: this.countPairChanges(cur),
    };
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
