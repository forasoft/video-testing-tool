// Rendered frames of the selected <video> via requestVideoFrameCallback:
// frame rate, freezes (PRD §7), first frame and presentation latency.
// All times are milliseconds from the session start.
//
// A callback runs once per rendering of the page, so when the page renders less often
// than the video changes (a busy or throttled main thread), one callback covers several
// presented frames. Frames are counted by the metadata's presentedFrames, not by callbacks.
import { SuspendReason } from "shared/protocol";
import { perf } from "./perf";

// Frame rate is the number of frames presented in the last this many ms.
export const FPS_WINDOW_MS = 1000;
// After the tab becomes visible or the video plays again, frames settle for this long (PRD §14.4).
export const RESUME_GUARD_MS = 200;
// Mean frame interval over this many normal intervals.
const INTERVAL_HISTORY = 30;
// No freeze detection until the mean is known.
const MIN_INTERVALS = 5;

// A stretch of the session: a freeze, or a time frames were not counted.
interface FreezeInterval {
  start: number;
  end: number;
}

// A freeze of the session list; `open` — still going on.
export interface ListedFreeze extends FreezeInterval {
  open: boolean;
}

// Counts the rendered frames from rVFC callbacks: frame rate and latency of the last second, freezes, and the times
// frames were not counted.
export class FrameClock {
  // The first frame and the last callback, and the last callback's presentedFrames.
  firstFrame: number | null = null;
  last: number | null = null;
  lastPresented: number | null = null;
  // The callbacks of the last FPS window: time, frames presented, latency.
  recent: { t: number; frames: number; latency: number | null }[] = [];
  // The last INTERVAL_HISTORY frame intervals that were not freezes.
  intervals: number[] = [];
  // Freezes that ended, also one cut short when frames stopped being counted.
  closed: FreezeInterval[] = [];
  // Why frames are not counted now; hidden and paused can hold at once.
  reasons = new Set<SuspendReason>();
  // An interval from a frame before this time is not counted: frames settle after a resume.
  guardUntil = -Infinity;
  // Times frames were not counted (tab hidden, video paused), and the start of the current one.
  suspended: FreezeInterval[] = [];
  suspendedSince: number | null = null;

  // Mean of the kept frame intervals; null while fewer than MIN_INTERVALS are kept.
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
    this.firstFrame ??= t;
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
    } else {
      this.closeStallAfterGuard(t);
    }
    this.last = t;
    this.lastPresented = presented;
    this.recent.push({ t, frames, latency });
    this.prune(t);
  }

  // Frames stop being counted for `reason`; the first reason starts a suspension.
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

  // The last reason gone ends the suspension; intervals count again from a frame at least RESUME_GUARD_MS after it.
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

  // Where the time without frames is counted from: the last frame or, when none has come since a resume, the end
  // of its guard — a stream that stays stalled after the tab returns is a freeze from then on. null while suspended.
  private countedFrom(): number | null {
    if (this.reasons.size > 0 || this.last === null) {
      return null;
    }
    return Math.max(this.last, this.guardUntil);
  }

  // A frame after a resume while frames settle: its interval says nothing of the pace, but a stall that went on
  // past the guard ends with it and is a freeze from the guard's end.
  private closeStallAfterGuard(t: number): void {
    const from = this.countedFrom();
    const threshold = this.threshold();
    if (from !== null && threshold !== null && t - from > threshold) {
      this.closed.push({ start: from, end: t });
    }
  }

  // The freeze going on at t: no frame for longer than the threshold while frames are counted; else null.
  ongoing(t: number): FreezeInterval | null {
    const from = this.countedFrom();
    const threshold = this.threshold();
    if (from === null || threshold === null || t - from <= threshold) {
      return null;
    }
    return { start: from, end: t };
  }

  // The ended freezes and the one going on at t, if any.
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

  // Total length of the freezes up to t, the one going on included.
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

  // Drops the callbacks that fall out of the FPS window ending at t.
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
