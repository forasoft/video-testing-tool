// Value and goodness of each metric as the Compact tiles and the timeline labels show it:
// both read these, so the same moment shows the same text.
import {
  FpsMessage, Goodness, SampleMessage, SuspendReason
} from "../../../shared/protocol";
import {
  formatFps, formatKbps, formatMs, formatPct, formatResolution
} from "./format";

// What a tile or a timeline label shows: the text (null — no data) and the goodness that colors it.
export interface MetricView {
  value: string | null;
  goodness?: Goodness;
  // No frames are rendered now (PRD §14.4): `—` with this reason's tooltip instead of a value.
  suspended?: SuspendReason;
}

const show = (value: number | null | undefined, format: (v: number) => string): string | null => (
  value === null || value === undefined ? null : format(value)
);

// What the views are drawn from: the latest sample and Frame rate of VTT_FPS (null until it comes). Only Frame rate
// and Freezes & Stalls read VTT_FPS.
export interface ViewSource {
  sample: SampleMessage | null;
  fps: FpsMessage | null;
}

// Whether frames are counted now: VTT_FPS tells it four times a second, VTT_SAMPLE once.
const suspendedNow = ({ fps, sample }: ViewSource): SuspendReason | undefined => (fps ? fps.suspended : sample?.suspended);

// Frame rate comes four times a second (VTT_FPS); until then — from the sample.
export const fpsView = (source: ViewSource): MetricView => {
  const { fps, sample } = source;
  const suspended = suspendedNow(source);
  if (suspended) {
    return { value: null, suspended };
  }
  return fps
    ? { value: formatFps(fps.fps), goodness: fps.goodness }
    : { value: show(sample?.values.v_fps_r, formatFps), goodness: sample?.goodness.fps };
};

// d_video, ms: half the RTT, the jitter buffer, decode and render together.
export const videoDelayView = ({ sample }: ViewSource): MetricView => (
  { value: show(sample?.values.d_video, formatMs), goodness: sample?.goodness.videoDelay }
);

// d_audio, ms: half the RTT and the audio jitter buffer.
export const audioDelayView = ({ sample }: ViewSource): MetricView => (
  { value: show(sample?.values.d_audio, formatMs), goodness: sample?.goodness.audioDelay }
);

// v_loss: the share of the video's packets lost over the last 5 s, %.
export const lossView = ({ sample }: ViewSource): MetricView => (
  { value: show(sample?.values.v_loss, formatPct), goodness: sample?.goodness.loss }
);

// The video element's frame size; no value until both its width and height are known.
export const resolutionView = ({ sample }: ViewSource): MetricView => {
  const width = sample?.values.v_w;
  const height = sample?.values.v_h;
  return {
    value: width && height ? formatResolution(width, height) : null,
    goodness: sample?.goodness.resolution,
  };
};

// v_freeze_pct: the frozen time of the whole session, % of it; `—` while frames are not counted, as Frame rate.
export const freezesView = (source: ViewSource): MetricView => {
  const { sample } = source;
  const suspended = suspendedNow(source);
  return suspended
    ? { value: null, suspended }
    : { value: show(sample?.values.v_freeze_pct, formatPct), goodness: sample?.goodness.freezes };
};

// v_bitrate: the received video's bitrate, kbps.
export const bitrateView = ({ sample }: ViewSource): MetricView => (
  { value: show(sample?.values.v_bitrate, formatKbps), goodness: sample?.goodness.bitrate }
);
