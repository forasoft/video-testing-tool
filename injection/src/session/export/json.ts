// JSON export of a session (PRD §15.1): its schema is Appendix C (§22). Everything the session knows —
// samples column-wise, events, problems with their cards, SDP, the Report's Distribution — for a ticket or
// a script, the other streams of the page and the previous run on the site it was compared with.
import { SAMPLE_FIELDS, SampleField } from "shared/constants/sampleFields";
import {
  EventMessage, ProblemCategory, ProblemMessage, SessionState, Severity, StreamRow, VerdictInfo,
} from "shared/protocol";
import { SampleBuffer } from "../buffer";
import { RtpStats, Snapshot } from "../extract";
import { codecName } from "../metrics";
import { RunSummary } from "../lastRun";
import { Distribution, FreezeStats, ReportStats } from "../report";

// The file's `schema`: the format's name and version, for scripts that read it.
export const SCHEMA = "streamtest-session/2";

// The export files: JSON (PRD §15.1) and CSV (§15.2).
export type ExportFormat = "json" | "csv";

// A received track of the selected stream.
interface ExportTrack {
  trackId: string | null;
  mid: string | null;
  ssrc: number | null;
  codec: string | null;
  fmtp: string | null;
}

// What the session knows when it is exported.
export interface ExportSource {
  extensionVersion: string;
  // ms since the epoch; endedAt is null while the session is live.
  startedAt: number;
  endedAt: number | null;
  // Seconds from the start to the end (or to now while live).
  durationS: number;
  state: SessionState;
  origin: string;
  url: string;
  hostname: string;
  userAgent: string;
  buffer: SampleBuffer;
  events: EventMessage[];
  problems: ProblemMessage[];
  verdict: VerdictInfo;
  // The Distribution of the Report (PRD §13.3).
  report: ReportStats;
  // The run this session is compared with (PRD §13.1), null on the first run on the site.
  previousRun: RunSummary | null;
  // Other streams on this page as of the last poll (PRD §13.4), the selected one among them.
  streams: StreamRow[];
  stream: {
    video: ExportTrack | null;
    audio: ExportTrack | null;
    element: { clientWidth: number; clientHeight: number; dpr: number | null } | null;
  };
  connection: {
    // Fields of the selected pair's candidates (getStats).
    local: Record<string, unknown> | null;
    remote: Record<string, unknown> | null;
    turnUrl: string | null;
    decoder: string | null;
    encoder: string | null;
  };
  sdp: { local: string | null; remote: string | null };
}

// A problem as the file keeps it: the message with its card's rows and texts, without the chart series.
interface ExportProblem {
  id: number;
  type: string;
  title: string;
  category: ProblemCategory;
  severity: Severity;
  tStart: number;
  tEnd: number | null;
  oneLine: string;
  rows: [string, string][];
  likelyCause: string;
  check: string;
}

// Another stream of the page as the table shows it (PRD §13.4).
type ExportStream = Pick<StreamRow, "id" | "name" | "w" | "h" | "bitrate" | "loss" | "freezes">;

// The JSON file (Appendix C, §22): the session's times as ISO strings, the samples column-wise.
interface SessionExport {
  schema: typeof SCHEMA;
  extensionVersion: string;
  session: {
    startedAt: string;
    endedAt: string | null;
    durationS: number;
    state: SessionState;
    origin: string;
    url: string;
    userAgent: string;
    // Older samples than the 60 minutes the buffer keeps were dropped (PRD §6.4).
    truncated: boolean;
  };
  stream: ExportSource["stream"];
  connection: ExportSource["connection"];
  sdp: ExportSource["sdp"];
  samples: Record<SampleField, (number | null)[]>;
  events: Pick<EventMessage, "n" | "t" | "kind" | "label">[];
  problems: ExportProblem[];
  verdict: { level: VerdictInfo["level"]; degradedS: number; worstProblemId: number | null; text: string };
  distribution: Distribution;
  freezes: FreezeStats;
  firstFrameS: number | null;
  otherStreams: ExportStream[];
  previousRun: RunSummary | null;
}

// A non-empty string and a finite number of a report field, else null.
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

// A received track from its inbound-rtp and codec reports.
export const exportTrack = (inbound?: RtpStats, codec?: RtpStats): ExportTrack | null => (inbound
  ? {
    trackId: text(inbound.trackIdentifier),
    mid: text(inbound.mid),
    ssrc: count(inbound.ssrc),
    codec: codecName(codec) ?? null,
    fmtp: text(codec?.sdpFmtpLine),
  }
  : null);

const CANDIDATE_FIELDS = ["candidateType", "address", "port", "protocol", "relayProtocol", "url", "networkType"];

// The fields of a candidate that tell where the media goes; those the browser does not report are left out.
export const exportCandidate = (candidate?: RtpStats): Record<string, unknown> | null => {
  if (!candidate) {
    return null;
  }
  const fields: Record<string, unknown> = {};
  CANDIDATE_FIELDS.forEach((key) => {
    const value = candidate[key];
    if (text(value) !== null || count(value) !== null) {
      fields[key] = value;
    }
  });
  return fields;
};

// The stream and connection of the latest getStats() of the session.
export const exportMedia = (snapshot: Snapshot | null, dpr: number | null): Pick<ExportSource, "stream" | "connection"> => {
  const { element, local } = snapshot ?? {};
  return {
    stream: {
      video: exportTrack(snapshot?.video, snapshot?.videoCodec),
      audio: exportTrack(snapshot?.audio, snapshot?.audioCodec),
      element: element ? { clientWidth: element.clientWidth, clientHeight: element.clientHeight, dpr } : null,
    },
    connection: {
      local: exportCandidate(local),
      remote: exportCandidate(snapshot?.remote),
      turnUrl: local?.candidateType === "relay" ? text(local.url) : null,
      decoder: text(snapshot?.video?.decoderImplementation),
      encoder: (snapshot?.outbound ?? []).map((layer) => text(layer.encoderImplementation)).find((name) => name !== null) ?? null,
    },
  };
};

// Three decimals are finer than any metric needs and keep an hour of samples near 1.5 MB (plan §4, 7).
export const roundValue = (value: number | null): number | null => (value === null ? null : Math.round(value * 1000) / 1000);

// All fields of PRD §6.3 in their order, oldest sample first.
export const exportSamples = (buffer: SampleBuffer): Record<SampleField, (number | null)[]> => {
  const samples = {} as Record<SampleField, (number | null)[]>;
  SAMPLE_FIELDS.forEach((field) => {
    samples[field] = buffer.lastN(field, buffer.size).map(roundValue);
  });
  return samples;
};

// The Distribution with the numbers of the samples' precision.
const exportDistribution = (d: Distribution): Distribution => ({
  v_bitrate: { p50: roundValue(d.v_bitrate.p50), p5: roundValue(d.v_bitrate.p5), min: roundValue(d.v_bitrate.min) },
  v_fps_r: { p50: roundValue(d.v_fps_r.p50), p5: roundValue(d.v_fps_r.p5), min: roundValue(d.v_fps_r.min) },
  v_loss: { p50: roundValue(d.v_loss.p50), p95: roundValue(d.v_loss.p95), max: roundValue(d.v_loss.max) },
  d_video: { p50: roundValue(d.d_video.p50), p95: roundValue(d.d_video.p95), max: roundValue(d.d_video.max) },
  rtt: { p50: roundValue(d.rtt.p50), p95: roundValue(d.rtt.p95), max: roundValue(d.rtt.max) },
});

// A problem message as the file keeps it.
const exportProblem = (p: ProblemMessage): ExportProblem => ({
  id: p.id,
  type: p.type,
  title: p.title,
  category: p.category,
  severity: p.severity,
  tStart: p.tStart,
  tEnd: p.tEnd,
  oneLine: p.oneLine,
  rows: p.card.rows,
  likelyCause: p.card.likelyCause,
  check: p.card.check,
});

// The streams other than the selected one: its own data is the rest of the file.
const exportStreams = (rows: StreamRow[]): ExportStream[] => rows
  .filter((row) => !row.selected)
  .map(({
    id, name, w, h, bitrate, loss, freezes,
  }) => ({
    id, name, w, h, bitrate: roundValue(bitrate), loss: roundValue(loss), freezes: roundValue(freezes),
  }));

// The JSON file from what the session knows; the samples and the Report's numbers are rounded by roundValue.
export const sessionJson = (source: ExportSource): SessionExport => ({
  schema: SCHEMA,
  extensionVersion: source.extensionVersion,
  session: {
    startedAt: new Date(source.startedAt).toISOString(),
    endedAt: source.endedAt === null ? null : new Date(source.endedAt).toISOString(),
    durationS: source.durationS,
    state: source.state,
    origin: source.origin,
    url: source.url,
    userAgent: source.userAgent,
    truncated: source.buffer.total > source.buffer.size,
  },
  stream: source.stream,
  connection: source.connection,
  sdp: source.sdp,
  samples: exportSamples(source.buffer),
  events: source.events.map(({ n, t, kind, label }) => ({ n, t, kind, label })),
  problems: source.problems.map(exportProblem),
  verdict: {
    level: source.verdict.level,
    degradedS: source.verdict.degradedS,
    worstProblemId: source.verdict.worst,
    text: source.verdict.text,
  },
  distribution: exportDistribution(source.report.distribution),
  freezes: {
    count: source.report.freezes.count,
    totalS: roundValue(source.report.freezes.totalS) as number,
    longestS: roundValue(source.report.freezes.longestS) as number,
    pct: roundValue(source.report.freezes.pct),
  },
  firstFrameS: roundValue(source.report.firstFrameS),
  otherStreams: exportStreams(source.streams),
  previousRun: source.previousRun,
});

// Indented for reading, but an array of numbers or strings stays on one line: a line per sample
// value would make an hour-long export 180 000 lines.
export const jsonText = (data: unknown): string =>
  JSON.stringify(data, null, 2).replace(/\[\n\s+([^[\]{}]*?)\n\s*\]/g, (_, items: string) => `[${items.replace(/,\n\s+/g, ", ")}]`);

const pad = (n: number) => String(n).padStart(2, "0");

// streamtest_{hostname}_{YYYYMMDD-HHmmss}.{ext}, the session's start in local time (PRD §15.1, §15.2).
export const exportFilename = (hostname: string, startedAt: number, format: ExportFormat): string => {
  const d = new Date(startedAt);
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const host = hostname.replace(/[^\w.-]+/g, "_") || "page";
  return `streamtest_${host}_${date}-${time}.${format}`;
};
