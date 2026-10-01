// Problem 2, Video freeze (PRD §12.3, card §12.4): no frame was shown for ≥ 1 s (rVFC, frames.ts).
// The cause tells where the frames stopped: on the network, in the decoder or in the video element.
import { groupThousands, mmss } from "shared/format";
import { ProblemCategory } from "shared/protocol";
import { ListedFreeze } from "../frames";
import { LongTask, TaskSource } from "../longtasks";
import { Description, Detector, median, Problem, ProblemEngine } from "./engine";

// severe from this long.
export const SEVERE_S = 3;
// page: a long task at least this long overlaps the freeze.
export const PAGE_TASK_MS = 200;
// network: in the 3 s before the freeze v_loss ≥ 2 % or v_bitrate < 50 % of its 30-s median,
// or no packet at all came over the selected pair for ≥ 2 s during the freeze. A drop in the
// network stops every packet (audio and RTCP too), a sender that stops sends the rest; loss of
// a short drop is repaired by retransmission, so packetsLost does not grow.
export const BEFORE_S = 3;
export const LOSS_PCT = 2;
export const DROP_SHARE = 0.5;
export const MEDIAN_WINDOW_S = 30;
// A median of fewer samples is not a baseline.
export const MIN_HISTORY = 5;
export const SILENCE_S = 2;
// decoder: frames kept arriving at ≥ half the usual rate and < 10 % of them were decoded;
// element: frames kept being decoded at ≥ half the usual rate. Usual — median of the 10 s before.
export const USUAL_WINDOW_S = 10;
export const KEPT_SHARE = 0.5;
export const DECODED_SHARE = 0.1;

export type FreezeCause = "page" | "network" | "decoder" | "element" | "unknown";

// Freezes up to t, seconds from the session start (FrameClock.list).
export type FreezeSource = (t: number) => ListedFreeze[];

// The selected <video>, its decoder and the selected pair at the latest sample.
export interface MediaState {
  readyState: number | null;
  decoder: string | null;
  // When the last packet came over the selected pair, seconds from the session start.
  lastPacketT: number | null;
}

export interface VideoFreezeData {
  // Seen while the freeze went on (right after it, if it began and ended between two samples).
  readyState: number | null;
  decoder: string | null;
  // Longest time without packets on the selected pair seen during the freeze, s.
  silence: number;
}

const CATEGORY: Record<FreezeCause, ProblemCategory> = {
  page: "Page",
  network: "Network",
  decoder: "Device",
  element: "Device",
  unknown: "Device",
};

const kbps = (value: number) => groupThousands(value);
const max = (values: number[]) => (values.length ? Math.max(...values) : null);
const min = (values: number[]) => (values.length ? Math.min(...values) : null);
const pct = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)} %`);

interface Frames {
  // Estimated frames during the freeze; null without data.
  count: number | null;
  // Median rate of the 10 s before the freeze, frames/s.
  usual: number | null;
}

export class VideoFreeze implements Detector<VideoFreezeData> {
  readonly type = "video_freeze";
  private readonly freezes: FreezeSource;
  private readonly media: () => MediaState;
  private readonly tasks: TaskSource;
  // Start of the last freeze that has ended and is handled: the list only grows at its end.
  private handled = -Infinity;

  // Without a source of long tasks the `page` cause is not checked and the card has no longest task.
  constructor(freezes: FreezeSource, media: () => MediaState, tasks: TaskSource = () => null) {
    this.freezes = freezes;
    this.media = media;
    this.tasks = tasks;
  }

  onSample(engine: ProblemEngine): void {
    this.freezes(engine.t)
      .filter((freeze) => freeze.start > this.handled)
      .forEach((freeze) => {
        const problem = engine.open<VideoFreezeData>(this.type, freeze.start, { readyState: null, decoder: null, silence: 0 });
        const seen = problem.data.readyState !== null || problem.data.decoder !== null;
        if (freeze.open || !seen) {
          this.observe(problem, engine);
        }
        if (!freeze.open) {
          engine.close(problem, freeze.end);
          this.handled = freeze.start;
        }
      });
  }

  private observe(problem: Problem<VideoFreezeData>, engine: ProblemEngine): void {
    const { readyState, decoder, lastPacketT } = this.media();
    const { data } = problem;
    data.readyState = readyState ?? data.readyState;
    data.decoder = decoder ?? data.decoder;
    if (lastPacketT !== null && lastPacketT <= engine.t) {
      data.silence = Math.max(data.silence, engine.t - lastPacketT);
    }
  }

  // Frames a per-second counter counted during the freeze: the samples that overlap it (a sample
  // at t covers t − 1…t), less the frames of their parts outside it at the usual rate.
  private frames(field: "v_fps_recv" | "v_fps_dec", problem: Problem<VideoFreezeData>, engine: ProblemEngine): Frames {
    const { tStart } = problem;
    const end = problem.tEnd ?? engine.t;
    const usual = engine.medianBefore(field, tStart, USUAL_WINDOW_S);
    const points = engine.points(field, tStart, end + 1).filter(([t, v]) => t > tStart && t - 1 < end && v !== null);
    if (!points.length) {
      return { count: null, usual };
    }
    const total = points.reduce((sum, [t, v]) => {
      const inside = Math.min(t, end) - Math.max(t - 1, tStart);
      return sum + (v as number) - (usual ?? 0) * (1 - inside);
    }, 0);
    return { count: Math.max(0, total), usual };
  }

  private networkBefore(problem: Problem<VideoFreezeData>, engine: ProblemEngine): boolean {
    const { tStart } = problem;
    const loss = max(engine.valuesBefore("v_loss", tStart, BEFORE_S));
    if (loss !== null && loss >= LOSS_PCT) {
      return true;
    }
    const history = engine.valuesBefore("v_bitrate", tStart, MEDIAN_WINDOW_S);
    const baseline = history.length >= MIN_HISTORY ? median(history) : null;
    const lowest = min(engine.valuesBefore("v_bitrate", tStart, BEFORE_S));
    return baseline !== null && lowest !== null && lowest < DROP_SHARE * baseline;
  }

  // The longest long task during the freeze; null — none, undefined — long tasks are not reported.
  private longestTask(problem: Problem<VideoFreezeData>, engine: ProblemEngine): LongTask | null | undefined {
    const tasks = this.tasks(problem.tStart, problem.tEnd ?? engine.t);
    if (tasks === null) {
      return undefined;
    }
    return tasks.reduce<LongTask | null>((longest, task) => (!longest || task.duration > longest.duration ? task : longest), null);
  }

  private cause(problem: Problem<VideoFreezeData>, engine: ProblemEngine, received: Frames, decoded: Frames, task?: LongTask | null): FreezeCause {
    if (task && task.duration >= PAGE_TASK_MS) {
      return "page";
    }
    if (this.networkBefore(problem, engine) || problem.data.silence >= SILENCE_S) {
      return "network";
    }
    const duration = engine.duration(problem);
    if (received.count !== null && decoded.count !== null && received.usual && received.count >= KEPT_SHARE * received.usual * duration
      && decoded.count < DECODED_SHARE * received.count) {
      return "decoder";
    }
    if (decoded.count !== null && decoded.usual && decoded.count >= KEPT_SHARE * decoded.usual * duration) {
      return "element";
    }
    return "unknown";
  }

  describe(problem: Problem<VideoFreezeData>, engine: ProblemEngine): Description {
    const { tStart, data } = problem;
    const end = problem.tEnd ?? engine.t;
    const duration = `${engine.duration(problem).toFixed(1)} s`;
    const received = this.frames("v_fps_recv", problem, engine);
    const decoded = this.frames("v_fps_dec", problem, engine);
    const task = this.longestTask(problem, engine);
    const cause = this.cause(problem, engine, received, decoded, task);
    const count = (frames: Frames) => (frames.count === null ? "—" : String(Math.round(frames.count)));
    const bitrateBefore = median(engine.valuesBefore("v_bitrate", tStart, BEFORE_S));
    let taskText = "—";
    if (task !== undefined) {
      taskText = task ? `${task.duration} ms` : "none";
    }

    const lowest = min(engine.values("v_bitrate", tStart - BEFORE_S, end));
    const texts: Record<FreezeCause, [string, string]> = {
      page: [
        `The page's JavaScript blocked the main thread for ${task?.duration ?? "—"} ms; the browser could not paint.`,
        `Profile the page's main thread around ${mmss(task?.start ?? tStart)}.`,
      ],
      network: [
        `Packets stopped arriving: loss ${pct(max(engine.values("v_loss", tStart - BEFORE_S, end)))}, bitrate fell to ${lowest === null ? "—" : kbps(lowest)} kbps.`,
        "Same as Bandwidth drop.",
      ],
      decoder: [
        "Frames arrived but the decoder produced none — decoder stall.",
        `Decoder: ${data.decoder ?? "—"}; try disabling hardware decoding.`,
      ],
      element: [
        "Frames were decoded but the video element did not show them.",
        `Is the element paused, hidden, or covered? readyState was ${data.readyState ?? "—"}.`,
      ],
      unknown: [
        "No network or page anomaly around the freeze.",
        `Compare with the sender's side at ${mmss(tStart)}.`,
      ],
    };
    const [likelyCause, check] = texts[cause];

    return {
      title: "Video freeze",
      category: CATEGORY[cause],
      severity: engine.duration(problem) >= SEVERE_S ? "severe" : "warn",
      oneLine: `${duration}, ${cause}`,
      card: {
        series: engine.cardSeries("v_fps_r", problem),
        rows: [
          ["Duration", duration],
          ["Frames received / decoded / rendered", `${count(received)} / ${count(decoded)} / 0`],
          ["Packet loss before", pct(max(engine.valuesBefore("v_loss", tStart, BEFORE_S)))],
          ["Bitrate before", bitrateBefore === null ? "—" : `${kbps(bitrateBefore)} kbps`],
          ["Longest page task", taskText],
        ],
        likelyCause,
        check,
      },
    };
  }
}
