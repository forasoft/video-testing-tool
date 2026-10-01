// The previous run on this site (PRD §13.1): a summary of the latest session on the origin that lasted at least
// 30 s. main.js keeps it in chrome.storage.local (`lastRun:{origin}`, one per origin); the page and main.js talk
// with DOM events on window — synchronous, so that a summary saved on beforeunload leaves before the page does.
import { EVENTS } from "shared/constants/events";
import { groupThousands } from "shared/format";
import { PreviousRunPart, VerdictInfo, VerdictLevel } from "shared/protocol";
import { degradedLabel, ReportStats } from "./report";

// A shorter session is not a run to compare with.
export const MIN_RUN_S = 30;

// Only numbers of the session: no addresses, no SDP (PRD §18).
export interface RunSummary {
  // ISO time of the start.
  startedAt: string;
  durationS: number;
  verdict: VerdictLevel;
  degradedS: number;
  // rVFC freezes (the Distribution's count).
  freezes: number;
  p95DelayMs: number | null;
  p95LossPct: number | null;
  p50BitrateKbps: number | null;
}

// Verdict levels from the best to the worst: they rank a change of level and check a stored summary.
const LEVELS: VerdictLevel[] = ["OK", "Degraded", "Severe"];

const tenths = (v: number) => Math.round(v * 10) / 10;
const whole = (v: number | null) => (v === null ? null : Math.round(v));

// The summary with the precision the line shows.
export const runSummary = (startedAt: number, durationS: number, verdict: VerdictInfo, stats: ReportStats): RunSummary => ({
  startedAt: new Date(startedAt).toISOString(),
  durationS: tenths(durationS),
  verdict: verdict.level,
  degradedS: verdict.level === "OK" ? 0 : tenths(verdict.degradedS),
  freezes: stats.freezes.count,
  p95DelayMs: whole(stats.distribution.d_video.p95),
  p95LossPct: stats.distribution.v_loss.p95 === null ? null : tenths(stats.distribution.v_loss.p95),
  p50BitrateKbps: whole(stats.distribution.v_bitrate.p50),
});

const isNumber = (value: unknown) => typeof value === "number" && Number.isFinite(value);
const isNumberOrNull = (value: unknown) => value === null || isNumber(value);

// A stored summary, or null when it is not one (nothing stored, another version, a page's own event).
export const parseRun = (detail: unknown): RunSummary | null => {
  try {
    const parsed: unknown = typeof detail === "string" ? JSON.parse(detail) : null;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const run = parsed as Record<keyof RunSummary, unknown>;
    const valid = typeof run.startedAt === "string" && LEVELS.includes(run.verdict as VerdictLevel)
      && [run.durationS, run.degradedS, run.freezes].every(isNumber)
      && [run.p95DelayMs, run.p95LossPct, run.p50BitrateKbps].every(isNumberOrNull);
    return valid ? (parsed as RunSummary) : null;
  } catch {
    return null;
  }
};

type Change = PreviousRunPart["change"];

// Less is better for everything the line compares; unknown values are not compared.
const lessIsBetter = (before: number | null, after: number | null): Change => {
  if (before === null || after === null || before === after) {
    return undefined;
  }
  return after < before ? "better" : "worse";
};

// Thousands with a narrow space, as everywhere (PRD §7).
const show = (value: number | null, format: (v: number) => string = groupThousands) => (value === null ? "—" : format(value));

// `Previous run on this site: Degraded 14.2 s → 9.7 s · freezes 3 → 2 · p95 delay 610 → 512 ms · p95 loss 5.1 → 3.9 %`;
// the verdict names its level again when it changed (`Degraded 9.7 s → OK 0 s`); the values of this run are the
// pieces colored by the change.
export const previousRunLine = (previous: RunSummary, current: RunSummary): PreviousRunPart[] => {
  const rank = LEVELS.indexOf(current.verdict) - LEVELS.indexOf(previous.verdict);
  let verdictChange = lessIsBetter(previous.degradedS, current.degradedS);
  if (rank !== 0) {
    verdictChange = rank < 0 ? "better" : "worse";
  }
  const now = degradedLabel(current.verdict, current.degradedS);
  const oneDecimal = (v: number) => v.toFixed(1);
  return [
    { text: `Previous run on this site: ${previous.verdict} ${degradedLabel(previous.verdict, previous.degradedS)} → ` },
    { text: rank === 0 ? now : `${current.verdict} ${now}`, change: verdictChange },
    { text: ` · freezes ${show(previous.freezes)} → ` },
    { text: show(current.freezes), change: lessIsBetter(previous.freezes, current.freezes) },
    { text: ` · p95 delay ${show(previous.p95DelayMs)} → ` },
    { text: show(current.p95DelayMs), change: lessIsBetter(previous.p95DelayMs, current.p95DelayMs) },
    { text: ` ms · p95 loss ${show(previous.p95LossPct, oneDecimal)} → ` },
    { text: show(current.p95LossPct, oneDecimal), change: lessIsBetter(previous.p95LossPct, current.p95LossPct) },
    { text: " %" },
  ];
};

// What this page knows of the previous run: what storage answered, or what the page saved since — that one is newer.
export class LastRuns {
  latest: RunSummary | null = null;
  // This page saved a run: it is newer than any answer of main.js, which no longer changes `latest`.
  savedHere = false;
  // Sessions waiting for main.js's answer.
  private waiting: ((run: RunSummary | null) => void)[] = [];
  private readonly store: (run: RunSummary) => void;

  constructor(store: (run: RunSummary) => void) {
    this.store = store;
  }

  // The previous run of a session starting now; `update` gets the stored one when main.js answers the start.
  forSession(update: (run: RunSummary | null) => void): RunSummary | null {
    if (!this.savedHere) {
      this.waiting.push(update);
    }
    return this.latest;
  }

  // main.js answered with the stored summary.
  loaded(run: RunSummary | null): void {
    if (!this.savedHere) {
      this.latest = run;
    }
    this.waiting.splice(0).forEach((update) => update(this.latest));
  }

  // A run of this page becomes the latest and is stored; waiting sessions are not told: it may be their own run.
  save(run: RunSummary): void {
    this.latest = run;
    this.savedHere = true;
    this.waiting = [];
    this.store(run);
  }
}

// The page's one LastRuns: a saved run goes to main.js as VTT_STORE_LAST_RUN.
export const lastRuns = new LastRuns((run) => {
  window.dispatchEvent(new CustomEvent(EVENTS.VTT_STORE_LAST_RUN, { detail: JSON.stringify(run) }));
});

// main.js answers each session's start with the summary it stored for this origin.
export const listenStoredRuns = (): void => {
  window.addEventListener(EVENTS.VTT_LAST_RUN, (event) => lastRuns.loaded(parseRun((event as CustomEvent).detail)));
};
