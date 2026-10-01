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

export const rowSpan = (rows: SampleValues[], row: SampleValues): [number, number] => {
  const t = row.t as number;
  const before = rows[rows.indexOf(row) - 1];
  const from = before && before.t !== null ? Math.max(before.t, t - MAX_ROW_SPAN_S) : t - 1;
  return [from, t];
};

// Names of the events of (from, to] for the tooltip.
export const eventNames = (events: EventMessage[], [from, to]: [number, number]): string[] =>
  events.filter((e) => e.t > from && e.t <= to).map((e) => e.label);

// Titles of the problems that go on in (from, to]; a problem that goes on lasts until now.
export const problemNames = (problems: ProblemMessage[], [from, to]: [number, number], now: number): string[] =>
  problems.filter((p) => p.tStart <= to && problemEnd(p, now) > from).map((p) => p.title);

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
