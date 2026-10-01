// Rows the timeline charts draw and its tooltip reads (PRD §11.2, §11.3): the samples the popup
// keeps and, for older or longer windows, the history the injection sent.
import { SAMPLE_FIELDS, SampleValues } from "../../../../../shared/constants/sampleFields";
import { HistoryMessage } from "../../../../../shared/protocol";
import { TimeWindow } from "./scale";

// The history's points as samples; the fields it does not carry are null.
export const historyRows = (history: HistoryMessage): SampleValues[] => (history.series.t ?? []).map((t, i) => {
  const row = {} as SampleValues;
  SAMPLE_FIELDS.forEach((field) => {
    row[field] = history.series[field]?.[i] ?? null;
  });
  row.t = t;
  return row;
});

// The history's points (historyRows of the answer: made once per answer, not on every render), then the kept samples
// that came after its last one.
export const chartRows = (kept: SampleValues[], rows: SampleValues[] | null): SampleValues[] => {
  if (!rows) {
    return kept;
  }
  const last = rows.length ? (rows[rows.length - 1].t as number) : -Infinity;
  return [...rows, ...kept.filter(({ t }) => t !== null && t > last)];
};

// The rows inside the window and one on each side of it, so that the lines reach its edges.
export const visibleRows = (rows: SampleValues[], { from, to }: TimeWindow): SampleValues[] => {
  const first = rows.findIndex(({ t }) => t !== null && t >= from);
  if (first === -1) {
    return [];
  }
  let last = first;
  while (last + 1 < rows.length && (rows[last + 1].t as number) <= to) {
    last += 1;
  }
  return rows.slice(Math.max(0, first - 1), last + 2);
};
