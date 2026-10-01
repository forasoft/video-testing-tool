// The cursor of the timeline and its tooltip (PRD §11.3): the second under the pointer and its
// values, read from the rows the charts draw.
import { SampleValues } from "../../../../../shared/constants/sampleFields";
import { groupThousands } from "../../../../../shared/format";
import { EventMessage, ProblemMessage } from "../../../../../shared/protocol";
import { problemEnd } from "../problems";
import { TimeWindow } from "./scale";

// The row inside the window closest in time to t; null when the window has none.
export const nearestRow = (rows: SampleValues[], t: number, { from, to }: TimeWindow): SampleValues | null =>
  rows.reduce<SampleValues | null>((best, row) => {
    const at = row.t;
    if (at === null || at < from || at > to) {
      return best;
    }
    return best === null || Math.abs(at - t) < Math.abs((best.t as number) - t) ? row : best;
  }, null);

// A row stands for the time since the row before it: a second for samples, a bucket for the
// points of the whole session; at most 10 s after a gap in the data.
const MAX_ROW_SPAN_S = 10;

// The seconds (from, to] a row stands for: the tooltip lists the events and problems of them.
export const rowSpan = (rows: SampleValues[], row: SampleValues): [number, number] => {
  const t = row.t as number;
  const index = rows.indexOf(row);
  const before = index > 0 ? rows[index - 1] : undefined;
  const from = before && before.t !== null ? Math.max(before.t, t - MAX_ROW_SPAN_S) : t - 1;
  return [from, t];
};

// The events of (from, to].
const eventsIn = (events: EventMessage[], [from, to]: [number, number]): EventMessage[] =>
  events.filter((e) => e.t > from && e.t <= to);

// The problems that go on in (from, to]; a problem that goes on lasts until now.
const problemsIn = (problems: ProblemMessage[], [from, to]: [number, number], now: number): ProblemMessage[] =>
  problems.filter((p) => p.tStart <= to && problemEnd(p, now) > from);

const or = (value: number | null, format: (v: number) => string): string => (value === null ? "—" : format(value));

const ms = (value: number) => groupThousands(value);

// Bitrate, Frame rate, Packet loss and Delay with its layers — the layers of the delay chart:
// network (rtt / 2), jitter buffer, decode + render.
export const cursorLines = (row: SampleValues): string[] => {
  const decode = row.d_decode === null && row.d_render === null ? null : (row.d_decode ?? 0) + (row.d_render ?? 0);
  const delay = row.d_video === null
    ? "Delay —"
    : `Delay ${ms(row.d_video)} ms — network ${or(row.d_net, ms)} · buffer ${or(row.d_jb, ms)} · decode ${or(decode, ms)}`;
  return [
    `Bitrate ${or(row.v_bitrate, (v) => `${groupThousands(v)} kbps`)}`,
    `Frame rate ${or(row.v_fps_r, (v) => `${v.toFixed(1)} fps`)}`,
    `Packet loss ${or(row.v_loss, (v) => `${v.toFixed(2)} %`)}`,
    delay,
  ];
};

// A line of the tooltip with a key that stays with its subject: the metric, the event's number, the problem's id.
export interface TooltipLine {
  key: string;
  text: string;
}

// The lines of cursorLines, in their order.
const METRIC_KEYS = ["bitrate", "fps", "loss", "delay"];

// The tooltip of the cursor (PRD §11.3): the metrics of its second, then the events and the problems of that second.
export const tooltipLines = (
  row: SampleValues,
  events: EventMessage[],
  problems: ProblemMessage[],
  span: [number, number],
  now: number,
): TooltipLine[] => [
  ...cursorLines(row).map((text, i) => ({ key: METRIC_KEYS[i], text })),
  ...eventsIn(events, span).map((e) => ({ key: `event-${e.n}`, text: e.label })),
  ...problemsIn(problems, span, now).map((p) => ({ key: `problem-${p.id}`, text: p.title })),
];
