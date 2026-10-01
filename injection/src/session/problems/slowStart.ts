// Problem 10, Slow start (PRD §12.3, card §12.4): the first frame of the stream came more than 4 s after
// the stream began. Judged only when the session caught that beginning: no frame had been shown yet.
import { pathLabel } from "../connection";
import { Description, Detector, Problem, ProblemEngine } from "./engine";

// Slow: no first frame 4 s after the origin; severe: later than 8 s; none in 15 s — closed as "no video".
export const SLOW_S = 4;
export const SEVERE_S = 8;
export const NO_VIDEO_S = 15;
// Likely cause: ICE itself took longer than this.
export const ICE_SLOW_S = 3;
// HTMLMediaElement.HAVE_CURRENT_DATA: the element has a frame to show.
const HAVE_CURRENT_DATA = 2;

// Times of the stream's start, seconds from the session start (negative — before it); null — not yet or unknown.
export interface StreamStart {
  // What the first frame is counted from; null when the stream showed frames before the session started.
  origin: number | null;
  iceConnected: number | null;
  firstPacket: number | null;
  firstFrame: number | null;
}

// The origin, seconds from the session start: setRemoteDescription of the video when it was set at most 15 s
// before the session, else the session start; null when the element already had a frame — the stream began
// before the session, which did not see its start.
export const streamOrigin = (remoteDescription: number | null, readyState: number): number | null => {
  if (readyState >= HAVE_CURRENT_DATA) {
    return null;
  }
  return remoteDescription !== null && remoteDescription <= 0 && remoteDescription >= -NO_VIDEO_S ? remoteDescription : 0;
};

interface SlowStartData {
  noVideo: boolean;
  // The selected path while the problem went on, and whether it is a relay.
  path: string | null;
  relay: boolean;
  // The stream's start as it was when the problem ended.
  final: StreamStart | null;
}

const seconds = (value: number) => `${value.toFixed(2)} s`;

export class SlowStart implements Detector<SlowStartData> {
  readonly type = "slow_start";
  private readonly start: () => StreamStart;
  // The first frame is known, or the problem is over: one slow start per session.
  private done = false;

  constructor(start: () => StreamStart) {
    this.start = start;
  }

  onSample(engine: ProblemEngine): void {
    const start = this.start();
    const { origin, firstFrame } = start;
    if (this.done || origin === null) {
      return;
    }
    let open = engine.current<SlowStartData>(this.type);
    if (!open) {
      if ((firstFrame ?? engine.t) - origin <= SLOW_S) {
        this.done = firstFrame !== null;
        return;
      }
      open = engine.open<SlowStartData>(this.type, Math.max(0, origin), {
        noVideo: false, path: null, relay: false, final: null,
      });
    }
    const path = pathLabel(engine.connection);
    if (path) {
      open.data.path = path;
      open.data.relay = engine.connection?.type === "relay";
    }
    if (firstFrame !== null && firstFrame < origin + NO_VIDEO_S) {
      open.data.final = start;
      engine.close(open, firstFrame);
      this.done = true;
    } else if (engine.t >= origin + NO_VIDEO_S) {
      open.data.noVideo = true;
      open.data.final = start;
      engine.close(open, origin + NO_VIDEO_S);
      this.done = true;
    }
  }

  describe(problem: Problem<SlowStartData>, engine: ProblemEngine): Description {
    const { noVideo, path, relay, final } = problem.data;
    const start = final ?? this.start();
    const origin = start.origin ?? 0;
    // Seconds after the origin; what happened before it counts as at it.
    const since = (t: number | null) => (t === null ? null : Math.max(0, t - origin));
    const frame = noVideo ? null : since(start.firstFrame);
    const ice = since(start.iceConnected);
    const packet = since(start.firstPacket);
    const waited = noVideo ? NO_VIDEO_S : frame ?? (problem.tEnd ?? engine.t) - origin;

    let firstFrame = frame === null ? "—" : seconds(frame);
    if (noVideo) {
      firstFrame = `none in ${NO_VIDEO_S} s`;
    }
    let likelyCause: string;
    if (ice === null) {
      likelyCause = `ICE did not connect in ${seconds(waited)}.`;
    } else if (ice > ICE_SLOW_S) {
      likelyCause = `ICE took ${seconds(ice)} to connect${relay ? " through a relay" : ""}.`;
    } else if (frame !== null) {
      likelyCause = `Connected in ${seconds(ice)} but the first frame came ${seconds(frame - ice)} later — waiting for a keyframe from the sender.`;
    } else {
      likelyCause = `Connected in ${seconds(ice)} but no frame came in ${seconds(waited - ice)} — waiting for a keyframe from the sender.`;
    }

    return {
      title: "Slow start",
      category: "Network",
      severity: waited > SEVERE_S ? "severe" : "warn",
      oneLine: noVideo ? `no video in ${NO_VIDEO_S} s` : `first frame after ${waited.toFixed(1)} s`,
      card: {
        series: engine.cardSeries("v_bitrate", problem),
        rows: [
          ["First frame", firstFrame],
          ["ICE connected at", ice === null ? "—" : seconds(ice)],
          ["First packet at", packet === null ? "—" : seconds(packet)],
          ["Path", path ?? "—"],
        ],
        likelyCause,
        check: "TURN configuration and UDP; keyframe request handling on the sender/SFU.",
      },
    };
  }
}
