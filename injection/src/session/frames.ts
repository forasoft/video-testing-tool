// Rendered frames of the selected <video> via requestVideoFrameCallback:
// frame rate, freezes (PRD §7), first frame and presentation latency.
// All times are milliseconds from the session start.
//
// A callback runs once per rendering of the page, so when the page renders less often
// than the video changes (a busy or throttled main thread), one callback covers several
// presented frames. Frames are counted by the metadata's presentedFrames, not by callbacks.
import { SuspendReason } from "shared/protocol";
import { perf } from "./perf";

export const FPS_WINDOW_MS = 1000;
// After the tab becomes visible or the video plays again, frames settle for this long (PRD §14.4).
export const RESUME_GUARD_MS = 200;
// Mean frame interval over this many normal intervals.
const INTERVAL_HISTORY = 30;
// No freeze detection until the mean is known.
const MIN_INTERVALS = 5;

export interface FreezeInterval {
  start: number;
  end: number;
}

// A freeze of the session list; `open` — still going on.
export interface ListedFreeze extends FreezeInterval {
  open: boolean;
}

export class FrameClock {
  firstFrame: number | null = null;
  last: number | null = null;
  lastPresented: number | null = null;
  recent: { t: number; frames: number; latency: number | null }[] = [];
  intervals: number[] = [];
  closed: FreezeInterval[] = [];
  reasons = new Set<SuspendReason>();
  guardUntil = -Infinity;
  // Times frames were not counted (tab hidden, video paused), and the start of the current one.
  suspended: FreezeInterval[] = [];
  suspendedSince: number | null = null;

  mean(): number | null {
    if (this.intervals.length < MIN_INTERVALS) {
      return null;
    }
    return this.intervals.reduce((sum, dt) => sum + dt, 0) / this.intervals.length;
  }

  // A freeze is a frame interval > max(3 × mean, mean + 150 ms).
  threshold(): number | null {
    const mean = this.mean();
    return mean === null ? null : Math.max(3 * mean, mean + 150);
  }

  // The interval from the last frame to `t` is not counted while suspended,
  // and neither is one that started before the guard after a resume ended.
  counts(): boolean {
    return this.reasons.size === 0 && this.last !== null && this.last >= this.guardUntil;
  }

  // `presented` — rVFC metadata.presentedFrames of this callback.
  frame(t: number, latency: number | null = null, presented: number | null = null): void {
    if (this.firstFrame === null) {
      this.firstFrame = t;
    }
    const counts = this.last !== null && this.counts();
    // Frames presented since the previous callback; 1 without the counter or after a pause.
    const frames = counts && presented !== null && this.lastPresented !== null && presented > this.lastPresented
      ? presented - this.lastPresented
      : 1;

    if (this.last !== null && counts) {
      const dt = t - this.last;
      const threshold = this.threshold();
      const mean = this.mean();
      // The frames after the first one are assumed to have come at the usual pace at the end.
      const gap = dt - (frames - 1) * (mean ?? 0);
      if (threshold !== null && gap > threshold) {
        this.closed.push({ start: this.last, end: this.last + gap });
      } else {
        for (let i = 0; i < frames; i++) {
          this.intervals.push(dt / frames);
        }
        this.intervals.splice(0, Math.max(0, this.intervals.length - INTERVAL_HISTORY));
      }
    }
    this.last = t;
    this.lastPresented = presented;
    this.recent.push({ t, frames, latency });
    this.prune(t);
  }

  suspend(reason: SuspendReason, t: number): void {
    if (this.reasons.size === 0) {
      // A freeze that was already going on before the tab was hidden still counts.
      const ongoing = this.ongoing(t);
      if (ongoing) {
        this.closed.push(ongoing);
      }
      this.suspendedSince = t;
    }
    this.reasons.add(reason);
  }

  resume(reason: SuspendReason, t: number): void {
    if (this.reasons.delete(reason) && this.reasons.size === 0) {
      this.guardUntil = t + RESUME_GUARD_MS;
      if (this.suspendedSince !== null) {
        this.suspended.push({ start: this.suspendedSince, end: Math.max(t, this.suspendedSince) });
        this.suspendedSince = null;
      }
    }
  }

  // Why frames are not counted now, null while they are; a hidden tab outranks a paused video.
  suspendReason(): SuspendReason | null {
    if (this.reasons.has("hidden")) {
      return "hidden";
    }
    return this.reasons.has("paused") ? "paused" : null;
  }

  // The suspensions up to t, oldest first; the last one may still go on (PRD §14.4).
  suspensions(t: number): FreezeInterval[] {
    const since = this.suspendedSince;
    return since === null ? this.suspended : [...this.suspended, { start: since, end: Math.max(t, since) }];
  }

  // Share of (from, to] that frames were not counted, 0…1; for an empty interval — whether they
  // are not counted at `to`.
  suspendedShare(from: number, to: number): number {
    if (to <= from) {
      return this.reasons.size > 0 ? 1 : 0;
    }
    const ms = this.suspensions(to).reduce((sum, s) => sum + Math.max(0, Math.min(s.end, to) - Math.max(s.start, from)), 0);
    return Math.min(1, ms / (to - from));
  }

  ongoing(t: number): FreezeInterval | null {
    const threshold = this.threshold();
    if (!this.counts() || threshold === null || this.last === null || t - this.last <= threshold) {
      return null;
    }
    return { start: this.last, end: t };
  }

  freezes(t: number): FreezeInterval[] {
    const ongoing = this.ongoing(t);
    return ongoing ? [...this.closed, ongoing] : this.closed;
  }

  // The freezes up to t, oldest first; the last one may still be going on.
  list(t: number): ListedFreeze[] {
    const ongoing = this.ongoing(t);
    const closed = this.closed.map((f) => ({ ...f, open: false }));
    return ongoing ? [...closed, { ...ongoing, open: true }] : closed;
  }

  freezeMs(t: number): number {
    return this.freezes(t).reduce((sum, f) => sum + f.end - f.start, 0);
  }

  // Frames presented during the last second.
  fps(t: number): number {
    this.prune(t);
    return this.recent.reduce((sum, f) => sum + f.frames, 0);
  }

  // Mean presentationTime − receiveTime of the frames of the last second.
  latency(t: number): number | null {
    this.prune(t);
    const values = this.recent
      .map((f) => f.latency)
      .filter((v): v is number => v !== null);
    return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  }

  prune(t: number): void {
    while (this.recent.length && this.recent[0].t <= t - FPS_WINDOW_MS) {
      this.recent.shift();
    }
  }

  // The session's clock jumped ahead by ms (__vtt.debug.fastForward): the last frames move with it, so that
  // the jump is not a freeze. A suspension going on covers the skipped time.
  skip(ms: number): void {
    if (this.last !== null) {
      this.last += ms;
    }
    this.recent.forEach((f) => {
      f.t += ms;
    });
    if (this.guardUntil > -Infinity) {
      this.guardUntil += ms;
    }
  }
}

// Feeds the clock from rVFC and from visibility / play-state changes of the page. `since` turns a
// performance.now() time into ms from the session start; `onFirstFrame` gets the time of the first
// rendered frame, ms from the session start. The time of each callback is kept for __vtt.debug.perf().
export const trackFrames = (
  video: HTMLVideoElement,
  clock: FrameClock,
  since: (now: number) => number,
  onFirstFrame?: (t: number) => void
): (() => void) => {
  let running = true;

  const onFrame = (now: number, metadata: VideoFrameCallbackMetadata) => {
    if (!running) {
      return;
    }
    const begin = performance.now();
    const latency = metadata.receiveTime !== undefined
      ? metadata.presentationTime - metadata.receiveTime
      : null;
    const first = clock.firstFrame === null;
    clock.frame(since(now), latency, metadata.presentedFrames);
    if (first && clock.firstFrame !== null && onFirstFrame) {
      onFirstFrame(clock.firstFrame);
    }
    video.requestVideoFrameCallback(onFrame);
    const end = performance.now();
    perf.frameMs.add(end - begin, end);
  };

  const onVisibility = () => {
    const t = since(performance.now());
    if (document.hidden) {
      clock.suspend("hidden", t);
    } else {
      clock.resume("hidden", t);
    }
  };
  const onPause = () => clock.suspend("paused", since(performance.now()));
  const onPlaying = () => clock.resume("paused", since(performance.now()));

  if (document.hidden) {
    clock.suspend("hidden", 0);
  }
  if (video.paused) {
    clock.suspend("paused", 0);
  }
  document.addEventListener("visibilitychange", onVisibility);
  video.addEventListener("pause", onPause);
  video.addEventListener("playing", onPlaying);
  video.requestVideoFrameCallback(onFrame);

  return () => {
    running = false;
    document.removeEventListener("visibilitychange", onVisibility);
    video.removeEventListener("pause", onPause);
    video.removeEventListener("playing", onPlaying);
  };
};
