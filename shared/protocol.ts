// Messages between injection (page) and popup (iframe), PRD §21 (Appendix B).
// Sent with window.postMessage as { id, data }. Types of messages that later tasks
// implement are declared here already; optional fields appear with their tasks.
import { SampleValues } from "./constants/sampleFields";

export const MESSAGES = {
  // injection → popup
  // The messages of one sample in one envelope, in order (PRD §18): the panel draws them in one render.
  VTT_BATCH: "VTT_BATCH",
  VTT_SESSION: "VTT_SESSION",
  VTT_SAMPLE: "VTT_SAMPLE",
  VTT_FPS: "VTT_FPS",
  VTT_EVENT: "VTT_EVENT",
  VTT_PROBLEM: "VTT_PROBLEM",
  VTT_STREAMS: "VTT_STREAMS",
  VTT_HISTORY: "VTT_HISTORY",
  VTT_REPORT: "VTT_REPORT",
  VTT_EXPORT_READY: "VTT_EXPORT_READY",
  VTT_SUMMARY_TEXT: "VTT_SUMMARY_TEXT",
  // __vtt.debug.perf() asks the panel for its renders and redraws (PRD §18)
  VTT_GET_PERF: "VTT_GET_PERF",
  // popup ↔ main.js: the panel mode; the page (injection) sees it too
  VTT_SET_MODE: "VTT_SET_MODE",
  // popup → injection
  VTT_MARK: "VTT_MARK",
  VTT_EXPORT: "VTT_EXPORT",
  VTT_GET_HISTORY: "VTT_GET_HISTORY",
  VTT_GET_REPORT: "VTT_GET_REPORT",
  VTT_COPY_SUMMARY: "VTT_COPY_SUMMARY",
  // the answer to VTT_GET_PERF
  VTT_PERF: "VTT_PERF",
} as const;

export type MessageId = typeof MESSAGES[keyof typeof MESSAGES];

// A message as window.postMessage carries it; VTT_BATCH carries a list of them.
export interface PanelMessage {
  id: string;
  data: unknown;
}

// PRD §7: good — green, moderate — yellow, bad — red.
export type Goodness = "good" | "moderate" | "bad";

export type GoodnessKey =
  | "fps"
  | "bitrate"
  | "resolution"
  | "loss"
  | "videoDelay"
  | "audioDelay"
  | "freezes"
  | "rtt"
  | "path"
  | "avOffset"
  | "qp"
  | "concealment";

// Only metrics that have a value in this sample.
export type GoodnessMap = Partial<Record<GoodnessKey, Goodness>>;

// The seven Compact tiles that have a sparkline (PRD §9.2).
export type SparklineKey = "fps" | "videoDelay" | "audioDelay" | "loss" | "resolution" | "freezes" | "bitrate";

// The last 120 values of each tile, oldest first, null-padded at the start while the
// session is shorter than 120 s.
export type Sparklines = Record<SparklineKey, (number | null)[]>;

export type SessionState = "idle" | "live" | "disconnected" | "stopped";

export type ProblemCategory = "Network" | "Sender" | "Page" | "Device";

export type Severity = "warn" | "severe";

export type VerdictLevel = "OK" | "Degraded" | "Severe";

export type PanelMode = "mini" | "compact" | "expanded";

// Why the selected video renders no frames now: the tab is hidden or the video is paused (PRD §14.4).
// Frame rate and Freezes & Stalls show `—` with its tooltip meanwhile.
export type SuspendReason = "hidden" | "paused";

// Tabs of Expanded (PRD §8.3).
export type ExpandedTab = "timeline" | "report";

// ---- injection → popup

export interface SessionMessage {
  state: SessionState;
  startedAt: number;
  hostname: string;
  hasOutbound: boolean;
  hasAudio: boolean;
  otherStreamsCount: number;
}

// The connection chip (Compact) and the connection line (Expanded), PRD §9.3, §8.3.
export interface ConnectionInfo {
  // Codec names without "video/" / "audio/".
  videoCodec: string | null;
  audioCodec: string | null;
  localType: string | null;
  remoteType: string | null;
  // The type the chip shows: the remote candidate's if it is relay, else the local one's.
  type: string | null;
  // Between this browser and the next hop: relayProtocol of a relay candidate, else protocol.
  proto: string | null;
  relayProtocol: string | null;
  rttMs: number | null;
  // `Local: …`, `Remote: …` and, through a TURN server, `TURN: …`.
  tooltip: string[];
  // Connection path goodness (PRD §7); absent without a selected candidate pair.
  goodness?: Goodness;
}

export interface VerdictInfo {
  level: VerdictLevel;
  degradedS: number;
  worst: number | null;
  // `Worst: {title} at {m:ss} — {one-line}` of the Timeline (PRD §11.1).
  text: string;
  // `{Verdict} {Σ} s of {m:ss}. Worst: {title} at {m:ss} ({x.x} s). {Attribution}` of the Report (§12.5).
  report?: string;
}

// Status row of Compact (PRD §9.1) and its Mini version (§9.6).
export interface StatusInfo {
  kind: "collecting" | "ok" | "now" | "past" | "disconnected";
  text: string;
  // m:ss of the session; for a disconnected stream — when it was lost.
  time: string;
  // Color of now / past: the problem's severity.
  severity?: Severity;
}

// Once a second. When the session ends, the last message is sent again with the final
// verdict and status: the same t, so it is not a new second of data.
export interface SampleMessage {
  // Seconds from the session start.
  t: number;
  values: SampleValues;
  goodness: GoodnessMap;
  sparklines?: Sparklines;
  connection?: ConnectionInfo;
  verdict?: VerdictInfo;
  status?: StatusInfo;
  // Frames are not counted at the time of the sample; absent while they are.
  suspended?: SuspendReason;
}

export interface FpsMessage {
  fps: number;
  goodness: Goodness;
  // As in SampleMessage, four times a second.
  suspended?: SuspendReason;
}

// Point events on the timeline, PRD §12.1.
export type EventKind =
  | "first_frame"
  | "layer_change"
  | "path_change"
  | "reconnect"
  | "tab_hidden"
  | "tab_visible"
  | "mark";

// Color of the event's circle: layer_change is yellow down and green up, so it is not fixed by kind.
export type EventTone = "green" | "yellow" | "gray" | "blue";

export interface EventMessage {
  // Numbered through the session from 1.
  n: number;
  // Seconds from the session start.
  t: number;
  kind: EventKind;
  label: string;
  tone: EventTone;
}

export interface ProblemSeries {
  // Sample field (PRD §6.3), or `longtask` — the page's long tasks.
  name: string;
  // [t, value], the problem ± 15 s. For bars: [start of the task, its duration in ms].
  points: [number, number | null][];
  // Bars instead of a line: Page jank draws its long tasks so (PRD §12.4).
  kind?: "bars";
}

export interface ProblemCard {
  series: ProblemSeries;
  // A dashed second series (Bandwidth drop: avail_in), only when the browser reports it.
  dashed?: ProblemSeries;
  rows: [string, string][];
  likelyCause: string;
  check: string;
}

export interface ProblemMessage {
  id: number;
  type: string;
  title: string;
  category: ProblemCategory;
  severity: Severity;
  tStart: number;
  tEnd: number | null;
  open: boolean;
  oneLine: string;
  card: ProblemCard;
}

// A row of Other streams on this page (PRD §13.4). Values are numbers for the popup to format; kbps and %.
export interface StreamRow {
  // The track id.
  id: string;
  // `Stream {N}`: the video tracks of the page numbered in the order they appeared.
  name: string;
  selected: boolean;
  w: number | null;
  h: number | null;
  bitrate: number | null;
  // Of the last 5 s.
  loss: number | null;
  // totalFreezesDuration / the time the stream was watched × 100; the selected stream — its tile's value.
  freezes: number | null;
  // The worst grade of the row's values; absent while it has none (a gray dot).
  goodness?: Goodness;
  // `track {id} · mid {mid}`
  tooltip: string;
}

// Every 5 s: the selected stream and the others, by number; empty when the page receives no other video.
export type StreamsMessage = StreamRow[];

export interface HistoryMessage {
  from: number;
  to: number;
  series: Partial<Record<string, (number | null)[]>>;
  hiddenRanges: [number, number][];
  events: EventMessage[];
  problems: ProblemMessage[];
}

// A row of the Report's Distribution table (PRD §13.3), ready to draw: numbers formatted, `—` without data.
export interface DistributionRow {
  // `Bitrate, kbps`, `Frame rate, fps`, `Packet loss, %`, `Video delay, ms`, `RTT, ms`, `Freezes`, `First frame`.
  metric: string;
  // typical (p50); Freezes and First frame have one cell across typical, bad moments and worst.
  typical: string;
  // bad moments: p5 of Bitrate and Frame rate (`1 210 (p5)`), p95 of the others.
  bad?: string;
  worst?: string;
  // Goodness of the worst value; of the share for Freezes and of the time for First frame.
  goodness?: Goodness;
  // `≥ 2 000`, `< 1 %`: the good threshold of §7.
  target: string;
}

// A piece of the Previous run line (PRD §13.1): a value that got better is green, a worse one red.
export interface PreviousRunPart {
  text: string;
  change?: "better" | "worse";
}

// What the Report shows besides the sample and the problems, every 5 s while it is open (PRD §6.2).
export interface ReportMessage {
  distribution: DistributionRow[];
  // `Previous run on this site: …` in pieces; null — `First run on this site`.
  previousRun: PreviousRunPart[] | null;
  // t of the oldest kept sample once older ones were dropped (PRD §16 F14), else null.
  truncatedFrom: number | null;
}

export interface ExportReadyMessage {
  format: "json" | "csv";
  url: string;
  filename: string;
}

export interface SummaryTextMessage {
  text: string;
}

// __vtt.debug.perf() (PRD §18): the panel's renders and redraws over the last `windowS` seconds.
export interface GetPerfMessage {
  windowS: number;
}

// ---- popup → injection

// The popup asks main.js for a mode; main.js applies it and sends it back to the popup.
// `tab` — the Expanded tab to open (status row → Report, connection chip → Timeline).
export interface SetModeMessage {
  mode: PanelMode;
  tab?: ExpandedTab;
}

export interface ExportMessage {
  format: "json" | "csv";
}

export interface GetHistoryMessage {
  from: number;
  to: number;
  buckets?: number;
  // A periodic refresh (Whole session every 5 s): while the session is live it is answered right before the next
  // VTT_SAMPLE, so that the panel draws both at once — one render a second (PRD §18).
  refresh?: boolean;
}

export interface GetReportMessage {
  // The Report's refresh every 5 s, answered as a history refresh is.
  refresh?: boolean;
}

// The answer to VTT_GET_PERF: the view the panel shows — tiles (Compact, Mini), timeline or report, null on the start
// screen — its renders per second and those of Frame rate (VTT_FPS), and the time of its redraws, ms (mean, p95 and
// max; null without redraws in the window).
export interface PanelPerfMessage {
  view: string | null;
  rendersPerS: number;
  fpsRendersPerS: number;
  redrawMs: { mean: number; p95: number; max: number } | null;
}
