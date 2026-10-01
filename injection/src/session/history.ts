// History of the session for the timeline windows the popup does not keep itself (PRD §11.1):
// the answer to VTT_GET_HISTORY (§21).
import { SampleField } from "shared/constants/sampleFields";
import { EventMessage, GetHistoryMessage, HistoryMessage, ProblemMessage } from "shared/protocol";
import { SampleBuffer } from "./buffer";

// Series the timeline charts draw and the cursor tooltip shows (PRD §11.2, §11.3).
export const HISTORY_FIELDS: SampleField[] = [
  "v_bitrate", "avail_in", "v_fps_r", "v_loss", "d_net", "d_jb", "d_decode", "d_render", "d_video",
];

export type HistorySeries = Record<string, (number | null)[]>;

export interface HistorySource {
  buffer: SampleBuffer;
  events: EventMessage[];
  problems: ProblemMessage[];
  // Times the tab was hidden or the video paused, seconds from the session start (PRD §14.4).
  hidden: { start: number; end: number }[];
}

const round = (t: number) => Math.round(t * 1000) / 1000;

const mean = (values: (number | null)[]): number | null => {
  const present = values.filter((v): v is number => v !== null);
  return present.length ? present.reduce((sum, v) => sum + v, 0) / present.length : null;
};

// The samples with from ≤ t ≤ to, oldest first: `t` and HISTORY_FIELDS. Without `buckets`, or when
// there are no more samples than buckets, every sample as it is. Otherwise [from, to] is split into
// `buckets` equal parts and each part with samples gives one point: the mean of their times and the
// mean of each field (null when every value is null — a gap in the line). A part without samples
// gives no point, so a part a little narrower than a second does not break the line.
export const historySeries = (buffer: SampleBuffer, from: number, to: number, buckets?: number): HistorySeries => {
  const fields: SampleField[] = ["t", ...HISTORY_FIELDS];
  const series: HistorySeries = {};
  fields.forEach((field) => {
    series[field] = [];
  });

  const inside: number[] = [];
  for (let i = 0; i < buffer.size; i++) {
    const t = buffer.at("t", i);
    if (t !== null && t >= from && t <= to) {
      inside.push(i);
    }
  }

  const parts = buckets !== undefined && buckets >= 1 ? Math.floor(buckets) : Infinity;
  if (inside.length <= parts || to <= from) {
    inside.forEach((i) => fields.forEach((field) => series[field].push(buffer.at(field, i))));
    return series;
  }

  const width = (to - from) / parts;
  const part = (i: number) => Math.min(parts - 1, Math.floor(((buffer.at("t", i) as number) - from) / width));
  let group: number[] = [];
  const flush = () => {
    if (!group.length) {
      return;
    }
    series.t.push(round(mean(group.map((i) => buffer.at("t", i))) as number));
    HISTORY_FIELDS.forEach((field) => series[field].push(mean(group.map((i) => buffer.at(field, i)))));
    group = [];
  };
  // The samples are in time order: a part's samples come one after another.
  inside.forEach((i) => {
    if (group.length && part(group[0]) !== part(i)) {
      flush();
    }
    group.push(i);
  });
  flush();
  return series;
};

// VTT_HISTORY for a VTT_GET_HISTORY: the series, and the hidden ranges, events and problems that
// fall into [from, to]; the hidden ranges are cut to it. A refresh (Whole session every 5 s) has no
// events and problems: the panel keeps them from their own messages since the first answer, and
// up to 200 problem cards every 5 s would load the page for nothing (PRD §18).
export const historyMessage = (source: HistorySource, {
  from, to, buckets, refresh,
}: GetHistoryMessage): HistoryMessage => ({
  from,
  to,
  series: historySeries(source.buffer, from, to, buckets),
  hiddenRanges: source.hidden
    .filter(({ start, end }) => end > from && start < to)
    .map(({ start, end }): [number, number] => [Math.max(start, from), Math.min(end, to)]),
  events: refresh ? [] : source.events
    .filter((e) => e.t >= from && e.t <= to)
    .map(({ n, t, kind, label, tone }) => ({ n, t, kind, label, tone })),
  problems: refresh ? [] : source.problems.filter((p) => p.tStart <= to && (p.tEnd === null || p.tEnd >= from)),
});
