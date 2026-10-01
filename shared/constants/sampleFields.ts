// Fields of one per-second sample (PRD §6.3), in export order.
// Every value is a number or null (no data), so the history can be stored column-wise in Float64Array.
// v_freeze_cnt / v_freeze_ms — the decoder's freezes from getStats; v_freeze_pct — the
// Freezes & Stalls tile: rVFC freezes of the whole session / its duration × 100.
export const SAMPLE_FIELDS = [
  "t",
  "v_bitrate", "v_fps_r", "v_fps_dec", "v_fps_recv", "v_w", "v_h", "v_loss", "v_jitter",
  "v_nack", "v_pli", "v_qp", "v_frames_dropped", "v_discarded", "v_freeze_cnt", "v_freeze_ms", "v_freeze_pct",
  "v_jb", "v_decode", "v_render", "v_playout_ts", "v_codec_id",
  "a_bitrate", "a_loss", "a_jitter", "a_jb", "a_concealed_pct", "a_playout_ts",
  "av_offset",
  "rtt", "avail_in", "pair_type", "pair_proto", "pair_changes",
  "out_bitrate", "out_target", "out_w", "out_h", "out_fps", "out_limit", "out_encoder",
  "longtask_max", "longtask_sum", "hidden",
  "d_net", "d_jb", "d_decode", "d_render", "d_video", "d_audio",
] as const;

export type SampleField = typeof SAMPLE_FIELDS[number];

export type SampleValues = Record<SampleField, number | null>;

// The injection keeps the last 60 minutes of samples (PRD §6.4): the oldest second is overwritten.
export const BUFFER_SECONDS = 3600;

// Categorical fields are stored as an index into these lists.
// pair_type — the type the connection chip shows: the remote candidate type if it is relay, else the local one.
export const CANDIDATE_TYPES = ["host", "srflx", "prflx", "relay"] as const;
// pair_proto — local candidate's relayProtocol for relay candidates, else its protocol.
export const PROTOCOLS = ["udp", "tcp", "tls"] as const;
// v_codec_id — codec name from the mimeType without "video/".
export const VIDEO_CODECS = ["VP8", "VP9", "H264", "AV1", "H265"] as const;
// out_limit — qualityLimitationReason of the outgoing video's top layer.
export const QUALITY_LIMITS = ["none", "cpu", "bandwidth", "other"] as const;
// out_encoder — whether the outgoing video's encoder is power-efficient (hardware): powerEfficientEncoder.
export const ENCODER_KINDS = ["software", "hardware"] as const;
