// Long tasks of the page's main thread (PerformanceObserver "longtask", tasks ≥ 50 ms): for Page
// jank, the `page` cause of Video freeze and the per-second fields longtask_max / longtask_sum.
import { BUFFER_SECONDS } from "shared/constants/sampleFields";

// A long task: start and end in seconds from the session start, duration in ms.
export interface LongTask {
  // Seconds from the session start.
  start: number;
  end: number;
  duration: number;
}

// Long tasks with from ≤ end and start ≤ to (overlapping [from, to]); null — the browser does not
// report long tasks.
export type TaskSource = (from: number, to: number) => LongTask[] | null;

const round = (t: number) => Math.round(t * 1000) / 1000;

// The page's long tasks: kept as long as the sample buffer for the detectors, drained into each sample's fields.
export class LongTasks {
  // Oldest first; tasks older than the sample buffer are dropped.
  tasks: LongTask[] = [];
  // Reported since the last drain().
  private fresh: LongTask[] = [];

  // `start` — seconds from the session start, `duration` — ms.
  add(start: number, duration: number): void {
    const task = { start: round(start), end: round(start + duration / 1000), duration: Math.round(duration) };
    this.tasks.push(task);
    this.fresh.push(task);
    while (this.tasks.length && this.tasks[0].end < task.end - BUFFER_SECONDS) {
      this.tasks.shift();
    }
  }

  // The longest task and the sum of the tasks the browser reported since the previous call, ms: the
  // fields of a sample. A task is reported right after it ends, so it lands in the sample taken then.
  drain(): { max: number; sum: number } {
    const durations = this.fresh.map((task) => task.duration);
    this.fresh = [];
    return {
      max: durations.length ? Math.max(...durations) : 0,
      sum: durations.reduce((sum, d) => sum + d, 0),
    };
  }

  // The kept tasks that overlap [from, to], seconds: the TaskSource of the detectors.
  between(from: number, to: number): LongTask[] {
    return this.tasks.filter((task) => task.end >= from && task.start <= to);
  }
}

// Feeds the tasks of the page from now on; `since` turns a performance.now() time into ms from the session start.
// Returns the function that stops it, or null when the browser does not report long tasks.
export const observeLongTasks = (tasks: LongTasks, since: (now: number) => number): (() => void) | null => {
  if (typeof PerformanceObserver === "undefined" || !PerformanceObserver.supportedEntryTypes.includes("longtask")) {
    return null;
  }
  const observer = new PerformanceObserver((list) => {
    list.getEntries().forEach((entry) => tasks.add(since(entry.startTime) / 1000, entry.duration));
  });
  observer.observe({ type: "longtask" });
  return () => observer.disconnect();
};
