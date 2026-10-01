// The Report tab (PRD §13): the verdict text for a ticket with the side the problems came from (§12.5),
// the Distribution of the session's samples (§13.3) and the summary for Copy summary (§15.3).
import { groupThousands, mmss } from "shared/format";
import { SampleField } from "shared/constants/sampleFields";
import {
  ConnectionInfo, DistributionRow, Goodness, PreviousRunPart, ProblemCategory, ProblemMessage, ReportMessage, VerdictInfo, VerdictLevel,
} from "shared/protocol";
import { percentileOf, SampleBuffer } from "./buffer";
import { pathLabel } from "./connection";
import {
  bitrateGoodness, bitrateTarget, delayGoodness, firstFrameGoodness, fpsGoodness, freezesGoodness, lossGoodness, rttGoodness,
} from "./goodness";
import { problemDuration, verdict, worstProblem } from "./verdict";

// Problems of these categories come from the network or the sender; Page and Device — from this computer.
const NETWORK_SIDE: ProblemCategory[] = ["Network", "Sender"];

// `Network, not the page.` / `The page or this device, not the network.` / `Both network and this device.`;
// empty without problems.
export const attribution = (problems: ProblemMessage[]): string => {
  const network = problems.some((p) => NETWORK_SIDE.includes(p.category));
  const device = problems.some((p) => !NETWORK_SIDE.includes(p.category));
  if (network && device) {
    return "Both network and this device.";
  }
  if (network) {
    return "Network, not the page.";
  }
  return device ? "The page or this device, not the network." : "";
};

// `Degraded 10.2 s of 2:00. Worst: Bandwidth drop at 0:38 (9.7 s). Both network and this device.`;
// `No problems in 2:00.` without problems. t — the session's duration, seconds.
export const reportText = (problems: ProblemMessage[], t: number): string => {
  const worst = worstProblem(problems, t);
  if (!worst) {
    return `No problems in ${mmss(t)}.`;
  }
  const { level, degradedS } = verdict(problems, t);
  const duration = problemDuration(worst, t).toFixed(1);
  return `${level} ${degradedS.toFixed(1)} s of ${mmss(t)}. Worst: ${worst.title} at ${mmss(worst.tStart)} (${duration} s). ${attribution(problems)}`;
};

// The verdict as VTT_SAMPLE carries it: the chip and the Timeline row (§11.1) and the Report's text (§12.5)
// change together, once a second.
export const sessionVerdict = (problems: ProblemMessage[], t: number): VerdictInfo => ({
  ...verdict(problems, t),
  report: reportText(problems, t),
});

// ---- Distribution (PRD §13.3)

export interface Interval {
  start: number;
  end: number;
}

// What the Distribution is counted from; times are seconds from the session start.
export interface DistributionSource {
  buffer: SampleBuffer;
  // Now, or the end of the session.
  t: number;
  // rVFC freezes (frames.ts); the last one may go on until t.
  freezes: Interval[];
  // Times frames were not counted: the tab hidden or the video paused (PRD §14.4).
  suspended: Interval[];
  // The first frame from the stream's start, as the first_frame event counts it; null — none yet.
  firstFrameS: number | null;
}

// Low values are bad for Bitrate and Frame rate: p5 and the minimum; high ones for the rest: p95 and the maximum.
export interface LowStats {
  p50: number | null;
  p5: number | null;
  min: number | null;
}

export interface HighStats {
  p50: number | null;
  p95: number | null;
  max: number | null;
}

export interface Distribution {
  v_bitrate: LowStats;
  v_fps_r: LowStats;
  v_loss: HighStats;
  d_video: HighStats;
  rtt: HighStats;
}

export interface FreezeStats {
  count: number;
  totalS: number;
  longestS: number;
  // Of the time frames were counted; null before any.
  pct: number | null;
}

export interface ReportStats {
  distribution: Distribution;
  freezes: FreezeStats;
  firstFrameS: number | null;
  // p50 of the frame height: the bitrate target depends on it.
  heightP50: number | null;
  truncatedFrom: number | null;
}

// Non-null values of a field over the kept samples; Frame rate without the seconds the tab was hidden or the
// video paused, even in part (their frames were not counted).
const values = (buffer: SampleBuffer, field: SampleField): number[] => {
  const out: number[] = [];
  for (let i = 0; i < buffer.size; i++) {
    const value = buffer.at(field, i);
    const hidden = buffer.at("hidden", i);
    if (value !== null && !(field === "v_fps_r" && hidden !== null && hidden > 0)) {
      out.push(value);
    }
  }
  return out;
};

const low = (list: number[]): LowStats => ({
  p50: percentileOf(list, 50), p5: percentileOf(list, 5), min: list.length ? Math.min(...list) : null,
});

const high = (list: number[]): HighStats => ({
  p50: percentileOf(list, 50), p95: percentileOf(list, 95), max: list.length ? Math.max(...list) : null,
});

// Length of an interval inside [from, to].
const inside = ({ start, end }: Interval, from: number, to: number): number => Math.max(0, Math.min(end, to) - Math.max(start, from));

// Percentiles over every kept sample (the last 60 minutes of a longer session, PRD §16 F14); the freezes of the
// same time, as a share of the time their frames were counted.
export const reportStats = ({
  buffer, t, freezes, suspended, firstFrameS,
}: DistributionSource): ReportStats => {
  const truncatedFrom = buffer.total > buffer.size ? buffer.at("t", 0) : null;
  // A sample covers the second before its t.
  const from = truncatedFrom === null ? 0 : truncatedFrom - 1;
  const lengths = freezes.map((f) => inside(f, from, t)).filter((length) => length > 0);
  const totalS = lengths.reduce((sum, length) => sum + length, 0);
  const counted = t - from - suspended.reduce((sum, s) => sum + inside(s, from, t), 0);

  return {
    distribution: {
      v_bitrate: low(values(buffer, "v_bitrate")),
      v_fps_r: low(values(buffer, "v_fps_r")),
      v_loss: high(values(buffer, "v_loss")),
      d_video: high(values(buffer, "d_video")),
      rtt: high(values(buffer, "rtt")),
    },
    freezes: {
      count: lengths.length,
      totalS,
      longestS: lengths.length ? Math.max(...lengths) : 0,
      pct: counted > 0 ? (totalS / counted) * 100 : null,
    },
    firstFrameS,
    heightP50: percentileOf(values(buffer, "v_h"), 50),
    truncatedFrom,
  };
};

const DASH = "—";

const show = (value: number | null, format: (v: number) => string): string => (value === null ? DASH : format(value));

// The formats of the tiles (PRD §7) without units: the unit is in the metric's name.
const whole = (v: number) => groupThousands(v);
const tenths = (v: number) => v.toFixed(1);
const hundredths = (v: number) => v.toFixed(2);

const graded = (value: number | null, goodness: (v: number) => Goodness): { goodness?: Goodness } => (
  value === null ? {} : { goodness: goodness(value) }
);

// The rows of the table: typical (p50), bad moments (p5 / p95), worst and the good threshold of §7.
export const distributionRows = ({
  distribution: d, freezes, firstFrameS, heightP50,
}: ReportStats): DistributionRow[] => [
  {
    metric: "Bitrate, kbps",
    typical: show(d.v_bitrate.p50, whole),
    bad: d.v_bitrate.p5 === null ? DASH : `${whole(d.v_bitrate.p5)} (p5)`,
    worst: show(d.v_bitrate.min, whole),
    ...graded(d.v_bitrate.min, (v) => bitrateGoodness(v, heightP50)),
    target: `≥ ${whole(bitrateTarget(heightP50))}`,
  },
  {
    metric: "Frame rate, fps",
    typical: show(d.v_fps_r.p50, tenths),
    bad: d.v_fps_r.p5 === null ? DASH : `${tenths(d.v_fps_r.p5)} (p5)`,
    worst: show(d.v_fps_r.min, tenths),
    ...graded(d.v_fps_r.min, fpsGoodness),
    target: "≥ 24",
  },
  {
    metric: "Packet loss, %",
    typical: show(d.v_loss.p50, hundredths),
    bad: show(d.v_loss.p95, hundredths),
    worst: show(d.v_loss.max, hundredths),
    ...graded(d.v_loss.max, lossGoodness),
    target: "< 1",
  },
  {
    metric: "Video delay, ms",
    typical: show(d.d_video.p50, whole),
    bad: show(d.d_video.p95, whole),
    worst: show(d.d_video.max, whole),
    ...graded(d.d_video.max, delayGoodness),
    target: "< 300",
  },
  {
    metric: "RTT, ms",
    typical: show(d.rtt.p50, whole),
    bad: show(d.rtt.p95, whole),
    worst: show(d.rtt.max, whole),
    ...graded(d.rtt.max, rttGoodness),
    target: "< 150",
  },
  {
    metric: "Freezes",
    typical: freezes.pct === null
      ? DASH
      : `${freezes.count} · ${tenths(freezes.totalS)} s total · longest ${tenths(freezes.longestS)} s · ${hundredths(freezes.pct)} %`,
    ...graded(freezes.pct, freezesGoodness),
    target: "< 1 %",
  },
  {
    metric: "First frame",
    typical: show(firstFrameS, (v) => `${hundredths(v)} s`),
    ...graded(firstFrameS, firstFrameGoodness),
    target: "< 4 s",
  },
];

// VTT_REPORT for a VTT_GET_REPORT (PRD §21); `previousRun` — the line of lastRun.ts, null on the first run.
export const reportMessage = (stats: ReportStats, previousRun: PreviousRunPart[] | null = null): ReportMessage => ({
  distribution: distributionRows(stats), previousRun, truncatedFrom: stats.truncatedFrom,
});

// ---- Copy summary (PRD §15.3)

export interface SummarySource {
  hostname: string;
  // The session's start, ms since the epoch.
  startedAt: number;
  // Now, or the end of the session, seconds from its start.
  t: number;
  problems: ProblemMessage[];
  stats: ReportStats;
  connection: ConnectionInfo | null;
}

const pad = (n: number) => String(n).padStart(2, "0");

// `2026-09-25 14:07`, local time.
export const localMinute = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

// Σ as the verdict shows it: `9.7 s`; `0 s` without problems (`OK 0 s`).
export const degradedLabel = (level: VerdictLevel, degradedS: number): string => (level === "OK" ? "0 s" : `${degradedS.toFixed(1)} s`);

// `0:38–0:48`; `1:02` for a problem shorter than 1 s; `0:38–now` while it goes on — as in the list (§11.4).
export const problemInterval = (problem: ProblemMessage): string => {
  const start = mmss(problem.tStart);
  if (problem.tEnd === null) {
    return `${start}–now`;
  }
  return problem.tEnd - problem.tStart < 1 ? start : `${start}–${mmss(problem.tEnd)}`;
};

// The text for a ticket: the session, the verdict, every problem with its one-liner, the Distribution in one line,
// codecs, path and first frame.
export const summaryText = ({
  hostname, startedAt, t, problems, stats, connection,
}: SummarySource): string => {
  const { level, degradedS } = verdict(problems, t);
  const { distribution: d, freezes, firstFrameS } = stats;
  const sorted = [...problems].sort((a, b) => a.tStart - b.tStart || a.id - b.id);
  const freezeText = freezes.pct === null ? DASH : `${freezes.count} / ${tenths(freezes.totalS)} s / ${hundredths(freezes.pct)} %`;
  return [
    `StreamTest — ${hostname} — ${localMinute(startedAt)} — ${mmss(t)}`,
    `${level} ${degradedLabel(level, degradedS)}. ${attribution(problems)}`.trim(),
    `Problems (${problems.length}):`,
    ...sorted.map((p) => `  ${problemInterval(p)}  ${p.title} (${problemDuration(p, t).toFixed(1)} s) — ${p.oneLine}`),
    [
      `Bitrate p50 ${show(d.v_bitrate.p50, whole)} kbps (p5 ${show(d.v_bitrate.p5, whole)})`,
      `Frame rate p50 ${show(d.v_fps_r.p50, tenths)} (p5 ${show(d.v_fps_r.p5, tenths)})`,
      `Loss p95 ${show(d.v_loss.p95, hundredths)} %`,
      `Delay p95 ${show(d.d_video.p95, whole)} ms`,
      `RTT p95 ${show(d.rtt.p95, whole)} ms`,
      `Freezes ${freezeText}`,
    ].join(" · "),
    [
      `Codecs ${connection?.videoCodec ?? DASH} / ${connection?.audioCodec ?? DASH}`,
      `Path ${pathLabel(connection) ?? DASH}`,
      `First frame ${show(firstFrameS, (v) => `${hundredths(v)} s`)}`,
    ].join(" · "),
  ].join("\n");
};
