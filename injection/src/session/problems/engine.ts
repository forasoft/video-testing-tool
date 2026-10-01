// Problems of the session (PRD §12.3): detectors open and close them on samples and signals;
// the engine numbers them, keeps their cards up to date and sends them to the popup.
import { SampleField, SampleValues } from "shared/constants/sampleFields";
import { ConnectionInfo, ProblemCard, ProblemCategory, ProblemMessage, Severity } from "shared/protocol";
import { SampleBuffer } from "../buffer";
import { EventLog } from "../events";

// PRD §6.4: the oldest problems are dropped beyond this.
export const PROBLEM_LIMIT = 200;
// A shorter problem is a blip: it is dropped and never shown.
export const MIN_DURATION_S = 1;
// The card's chart shows the problem ± this, so a closed card is refreshed until then.
export const CARD_MARGIN_S = 15;
// "Before t" in sample windows: the sample at t itself is left out.
const BEFORE = 1e-6;

export type ProblemType =
  | "bandwidth_drop"
  | "video_freeze"
  | "page_jank"
  | "path_changed"
  | "reconnection"
  | "upload_limited"
  | "audio_stutter"
  | "av_sync"
  | "blurry"
  | "slow_start";

export interface Problem<D = unknown> {
  // 0 until the problem has lasted MIN_DURATION_S and is shown.
  id: number;
  type: ProblemType;
  // Seconds from the session start; tEnd is null while the problem goes on.
  tStart: number;
  tEnd: number | null;
  // The detector's own facts about the problem (values before it, flags).
  data: D;
  // The last message sent to the popup.
  message: ProblemMessage | null;
}

// What a detector says about one of its problems at the engine's current time.
export interface Description {
  title: string;
  category: ProblemCategory;
  severity: Severity;
  oneLine: string;
  card: ProblemCard;
}

// Facts that do not come with samples.
export interface IceSignal {
  kind: "ice";
  t: number;
  state: RTCIceConnectionState;
  // When the last packet arrived on the selected pair, seconds from the session start.
  lastPacketT: number | null;
}

export type Signal = IceSignal;

export interface Detector<D = unknown> {
  type: ProblemType;
  onSample?(engine: ProblemEngine): void;
  onSignal?(signal: Signal, engine: ProblemEngine): void;
  describe(problem: Problem<D>, engine: ProblemEngine): Description;
  // false while a closed problem's card can still change after CARD_MARGIN_S.
  settled?(problem: Problem<D>, engine: ProblemEngine): boolean;
}

interface EngineOptions {
  buffer: SampleBuffer;
  events: EventLog;
  detectors: Detector[];
  send?: (message: ProblemMessage) => void;
  // A detector ends the session (Reconnection not recovered).
  onEnd?: (reason: string) => void;
}

const round = (t: number) => Math.round(t * 1000) / 1000;

export const median = (values: number[]): number | null => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

export class ProblemEngine {
  readonly buffer: SampleBuffer;
  readonly events: EventLog;
  // Now, seconds from the session start: the latest sample or signal.
  t = 0;
  sample: SampleValues | null = null;
  connection: ConnectionInfo | null = null;
  // Oldest first; includes problems not yet shown.
  problems: Problem[] = [];
  private readonly detectors: Detector[];
  private readonly send: (message: ProblemMessage) => void;
  private readonly onEnd: (reason: string) => void;
  private count = 0;
  private endReason: string | null = null;
  private finished = false;

  constructor({ buffer, events, detectors, send = () => undefined, onEnd = () => undefined }: EngineOptions) {
    this.buffer = buffer;
    this.events = events;
    this.detectors = detectors;
    this.send = send;
    this.onEnd = onEnd;
  }

  // ---- session side

  onSample(sample: SampleValues, connection?: ConnectionInfo): void {
    if (this.finished || sample.t === null) {
      return;
    }
    this.t = sample.t;
    this.sample = sample;
    if (connection) {
      this.connection = connection;
    }
    this.run((detector) => detector.onSample?.(this));
  }

  signal(signal: Signal): void {
    if (this.finished) {
      return;
    }
    this.t = Math.max(this.t, signal.t);
    this.run((detector) => detector.onSignal?.(signal, this));
  }

  // The session is over: open problems end now.
  finish(t: number): void {
    if (this.finished) {
      return;
    }
    this.t = Math.max(this.t, t);
    this.problems.filter((p) => p.tEnd === null).forEach((p) => this.close(p, this.t));
    this.refresh();
    this.finished = true;
  }

  // Problems shown so far, oldest first.
  list(): ProblemMessage[] {
    return this.problems.filter((p) => p.message).map((p) => p.message as ProblemMessage);
  }

  // ---- detector side

  current<D>(type: ProblemType): Problem<D> | null {
    return (this.problems.find((p) => p.type === type && p.tEnd === null) as Problem<D>) ?? null;
  }

  // Problems of one type do not overlap: while one is open, it is returned instead.
  open<D>(type: ProblemType, tStart: number, data: D): Problem<D> {
    const existing = this.current<D>(type);
    if (existing) {
      return existing;
    }
    const problem: Problem<D> = { id: 0, type, tStart: round(tStart), tEnd: null, data, message: null };
    this.problems.push(problem);
    return problem;
  }

  close(problem: Problem, tEnd: number): void {
    if (problem.tEnd === null) {
      problem.tEnd = round(Math.max(tEnd, problem.tStart));
    }
  }

  endSession(reason: string): void {
    this.endReason = this.endReason ?? reason;
  }

  // Non-null values of the samples with from ≤ t ≤ to.
  values(field: SampleField, from: number, to: number): number[] {
    return this.buffer.range(field, from, to).filter((v): v is number => v !== null);
  }

  // Values of the `seconds` before t, the sample at t left out.
  valuesBefore(field: SampleField, t: number, seconds: number): number[] {
    return this.values(field, t - seconds, t - BEFORE);
  }

  // Median of the `seconds` before t, the sample at t left out.
  medianBefore(field: SampleField, t: number, seconds: number): number | null {
    return median(this.valuesBefore(field, t, seconds));
  }

  // Values of the last `seconds` up to now, the current sample included.
  recent(field: SampleField, seconds: number): number[] {
    return this.values(field, this.t - seconds + BEFORE, this.t);
  }

  // Samples of a field with from ≤ t ≤ to as [t, value] points for a card chart.
  points(field: SampleField, from: number, to: number): [number, number | null][] {
    const times = this.buffer.range("t", from, to);
    const values = this.buffer.range(field, from, to);
    return times.map((t, i) => [t as number, values[i]]);
  }

  // The problem ± CARD_MARGIN_S, up to now.
  cardSeries(field: SampleField, problem: Problem): ProblemCard["series"] {
    const to = Math.min(this.t, (problem.tEnd ?? this.t) + CARD_MARGIN_S);
    return { name: field, points: this.points(field, problem.tStart - CARD_MARGIN_S, to) };
  }

  duration(problem: Problem): number {
    return (problem.tEnd ?? this.t) - problem.tStart;
  }

  // ---- internals

  private run(step: (detector: Detector) => void): void {
    this.detectors.forEach(step);
    this.refresh();
    if (this.endReason !== null) {
      const reason = this.endReason;
      this.endReason = null;
      this.onEnd(reason);
    }
  }

  private detector(type: ProblemType): Detector {
    return this.detectors.find((d) => d.type === type) as Detector;
  }

  private refresh(): void {
    // Blips that ended before they were shown are dropped.
    this.problems = this.problems.filter((p) => p.id > 0 || p.tEnd === null || p.tEnd - p.tStart >= MIN_DURATION_S);

    this.problems.forEach((problem) => {
      if (problem.id === 0) {
        if (this.duration(problem) < MIN_DURATION_S) {
          return;
        }
        this.count += 1;
        problem.id = this.count;
      }
      const detector = this.detector(problem.type);
      const done = problem.tEnd !== null && this.t > problem.tEnd + CARD_MARGIN_S;
      if (problem.message && done && detector.settled?.(problem, this) !== false) {
        return;
      }
      const description = detector.describe(problem, this);
      const message: ProblemMessage = {
        id: problem.id,
        type: problem.type,
        title: description.title,
        category: description.category,
        severity: description.severity,
        tStart: problem.tStart,
        tEnd: problem.tEnd,
        open: problem.tEnd === null,
        oneLine: description.oneLine,
        card: description.card,
      };
      if (!problem.message || JSON.stringify(message) !== JSON.stringify(problem.message)) {
        problem.message = message;
        this.send(message);
      }
    });

    let shown = this.problems.filter((p) => p.id > 0).length;
    while (shown > PROBLEM_LIMIT) {
      const oldest = this.problems.findIndex((p) => p.id > 0 && p.tEnd !== null);
      if (oldest === -1) {
        return;
      }
      this.problems.splice(oldest, 1);
      shown -= 1;
    }
  }
}
