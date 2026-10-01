// Gray bands of the timeline: the tab was hidden or the video paused (PRD §11.2, §14.4).
import { SampleValues } from "../../../../../shared/constants/sampleFields";

// [start, end], seconds from the session start.
type Range = [number, number];

// Runs of samples with `hidden` > 0. `hidden` is the share of the sample's second (t − 1…t) when
// frames were not counted, so a run starts that much before its first sample and ends that much
// after the second before its last one; a run of one sample ends at its time.
export const hiddenRuns = (rows: SampleValues[]): Range[] => {
  const out: Range[] = [];
  let run: SampleValues[] = [];
  const flush = () => {
    if (run.length) {
      const first = run[0];
      const last = run[run.length - 1];
      const start = (first.t as number) - (first.hidden as number);
      const end = run.length === 1 ? (last.t as number) : (last.t as number) - 1 + (last.hidden as number);
      out.push([start, Math.max(start, end)]);
    }
    run = [];
  };
  rows.forEach((row) => {
    if (row.t !== null && row.hidden !== null && row.hidden > 0) {
      run.push(row);
    } else {
      flush();
    }
  });
  flush();
  return out;
};

// The ranges in time order, overlapping ones joined.
export const mergeRanges = (ranges: Range[]): Range[] => [...ranges]
  .sort((a, b) => a[0] - b[0])
  .reduce<Range[]>((out, [start, end]) => {
    const last = out.length > 0 ? out[out.length - 1] : undefined;
    if (last && start <= last[1]) {
      last[1] = Math.max(last[1], end);
    } else {
      out.push([start, end]);
    }
    return out;
  }, []);
