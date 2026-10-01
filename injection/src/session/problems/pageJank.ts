// Problem 3, Page jank (PRD §12.3, card §12.4): a long task of the page's JavaScript, and the frame
// rate fell while the network was fine.
//
// Chrome presents the frames of a <video> without the main thread, so a jank of the receiving page
// alone does not stop the video; the frame rate falls when the page's JavaScript also produces the
// frames (a sender or a preview in the same page, the stand). Such a sender pauses its bitrate for
// that second too, so the bitrate — like the frame rate — is judged in the task's second or the next.
import { groupThousands, mmss } from "shared/format";
import { LongTask, TaskSource } from "../longtasks";
import { CARD_MARGIN_S, Description, Detector, median, Problem, ProblemEngine } from "./engine";

// A task this long starts a jank.
const TASK_MS = 200;
// Medians of the frame rate and the bitrate over this many seconds before the task, of at least
// MIN_HISTORY samples.
export const MEDIAN_WINDOW_S = 10;
export const MIN_HISTORY = 5;
// Frame rate < 70 % of its median in the task's second or the next; loss < 1 % in the task's second;
// bitrate ≥ 80 % of its median in the task's second or the next.
const FPS_SHARE = 0.7;
export const LOSS_PCT = 1;
export const BITRATE_SHARE = 0.8;
// The jank ends this long after its last task.
const AFTER_S = 1;
// The sample of a task's second is the first one taken after the task; t is rounded to 0.1 s.
const ROUNDING_S = 0.05;

// A jank: its end, longest task and lowest frame rate cover all of its tasks; the rest is of its first task.
interface PageJankData {
  // The last task's end + 1 s.
  end: number;
  // ms
  longest: number;
  fpsBefore: number;
  fpsDuring: number;
  // Of the task's second (the bitrate — of the second that passed the check).
  loss: number;
  bitrate: number;
  rtt: number | null;
}

// What decide() says of a task: the facts of a jank, not a jank, or wait for the sample of the next second.
type Decision = Omit<PageJankData, "end" | "longest"> | "no" | "wait";

const kbps = (value: number) => groupThousands(value);

// Detects Page jank: a long task ≥ TASK_MS after which the frame rate fell while loss and bitrate stayed normal.
export class PageJank implements Detector<PageJankData> {
  readonly type = "page_jank";
  private readonly tasks: TaskSource;
  // Tasks ≥ 200 ms not decided yet, and the start of the latest task taken.
  private pending: LongTask[] = [];
  private taken = -Infinity;

  // `tasks` — the page's long tasks in a time range, null when the browser does not report them.
  constructor(tasks: TaskSource) {
    this.tasks = tasks;
  }

  // Takes the new long tasks, decides those whose seconds have come, and closes the jank after its end.
  onSample(engine: ProblemEngine): void {
    (this.tasks(this.taken, engine.t) ?? [])
      .filter((task) => task.start > this.taken && task.duration >= TASK_MS)
      .forEach((task) => {
        this.pending.push(task);
        this.taken = task.start;
      });

    this.pending = this.pending.filter((task) => {
      const decision = this.decide(task, engine);
      if (decision === "wait") {
        return true;
      }
      if (decision !== "no") {
        this.jank(task, decision, engine);
      }
      return false;
    });

    // A task still waiting for its second may extend the jank.
    const open = engine.current<PageJankData>(this.type);
    if (open && engine.t >= open.data.end && !this.pending.some((task) => task.start <= open.data.end)) {
      engine.close(open, open.data.end);
    }
  }

  // Judged on the sample of the task's second and, unless that one already shows a jank, of the next second too.
  private decide(task: LongTask, engine: ProblemEngine): Decision {
    const seconds = engine.points("t", task.end - ROUNDING_S, engine.t).map(([t]) => t);
    if (!seconds.length) {
      return "wait";
    }
    // The value of a field in the sample of second `t`, null when that second has none.
    const at = (field: "v_fps_r" | "v_bitrate" | "v_loss" | "rtt" | "hidden", t: number): number | null => {
      const values = engine.values(field, t, t);
      return values.length > 0 ? values[0] : null;
    };
    // The second of the task, and the one after it if it has come.
    const first = seconds[0];
    const next = seconds.length > 1 ? seconds[1] : undefined;

    // A hidden tab or a paused video shows no frames anyway (PRD §14.4).
    if ((at("hidden", first) ?? 0) > 0) {
      return "no";
    }
    const fpsHistory = engine.valuesBefore("v_fps_r", task.start, MEDIAN_WINDOW_S);
    const bitrateHistory = engine.valuesBefore("v_bitrate", task.start, MEDIAN_WINDOW_S);
    const loss = at("v_loss", first);
    if (fpsHistory.length < MIN_HISTORY || bitrateHistory.length < MIN_HISTORY || loss === null || loss >= LOSS_PCT) {
      return "no";
    }
    const fpsBefore = median(fpsHistory) as number;
    const bitrateBefore = median(bitrateHistory) as number;
    const fpsLow = (t: number) => {
      const fps = at("v_fps_r", t);
      return fps !== null && fps < FPS_SHARE * fpsBefore;
    };
    const bitrateOk = (t: number) => {
      const bitrate = at("v_bitrate", t);
      return bitrate !== null && bitrate >= BITRATE_SHARE * bitrateBefore;
    };

    if (next === undefined && !(fpsLow(first) && bitrateOk(first))) {
      return "wait";
    }
    const judged = next === undefined ? [first] : [first, next];
    const normal = judged.find(bitrateOk);
    if (!judged.some(fpsLow) || normal === undefined) {
      return "no";
    }
    const during = judged.map((t) => at("v_fps_r", t)).filter((v): v is number => v !== null);
    return {
      fpsBefore,
      fpsDuring: Math.min(...during),
      loss,
      bitrate: at("v_bitrate", normal) as number,
      rtt: at("rtt", first),
    };
  }

  // Tasks closer than 1 s make one jank: problems of one type do not overlap.
  private jank(task: LongTask, facts: Exclude<Decision, "no" | "wait">, engine: ProblemEngine): void {
    const open = engine.current<PageJankData>(this.type);
    if (open) {
      open.data.end = Math.max(open.data.end, task.end + AFTER_S);
      open.data.longest = Math.max(open.data.longest, task.duration);
      open.data.fpsDuring = Math.min(open.data.fpsDuring, facts.fpsDuring);
      return;
    }
    engine.open<PageJankData>(this.type, task.start, { ...facts, end: task.end + AFTER_S, longest: task.duration });
  }

  // The card's chart is the page's long tasks around the problem, as bars.
  describe(problem: Problem<PageJankData>, engine: ProblemEngine): Description {
    const {
      longest, fpsBefore, fpsDuring, loss, bitrate, rtt,
    } = problem.data;
    const from = problem.tStart - CARD_MARGIN_S;
    const to = Math.min(engine.t, (problem.tEnd ?? engine.t) + CARD_MARGIN_S);
    const tasks = this.tasks(from, to) ?? [];

    return {
      title: "Page jank",
      category: "Page",
      severity: "warn",
      oneLine: `main thread blocked ${longest} ms`,
      card: {
        series: { name: "longtask", kind: "bars", points: tasks.map((task): [number, number] => [task.start, task.duration]) },
        rows: [
          ["Longest task", `${longest} ms`],
          ["Frame rate", `${fpsBefore.toFixed(1)} → ${fpsDuring.toFixed(1)} fps`],
          ["Packet loss / Bitrate / RTT", `${loss.toFixed(2)} % / ${kbps(bitrate)} kbps / ${rtt === null ? "—" : Math.round(rtt)} ms — normal`],
        ],
        likelyCause: `The page's JavaScript, not the stream: the main thread was busy for ${longest} ms while the network was fine.`,
        check: `Performance profile of the page around ${mmss(problem.tStart)}; heavy DOM updates or timers.`,
      },
    };
  }
}
