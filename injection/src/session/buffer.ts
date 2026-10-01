// Per-second history of the session: one Float64Array ring per sample field (PRD §6.3),
// 3600 s; the oldest second is overwritten. null is stored as NaN. Samples come in time order,
// so a time range is found by binary search: the detectors read windows of a few seconds every
// second, and a full hour must not make that slower (PRD §18).
import { BUFFER_SECONDS, SAMPLE_FIELDS, SampleField, SampleValues } from "shared/constants/sampleFields";

export { BUFFER_SECONDS };

export interface Buckets {
  // Start time of each bucket, seconds.
  t: number[];
  min: (number | null)[];
  max: (number | null)[];
  mean: (number | null)[];
}

const toValue = (x: number): number | null => (Number.isNaN(x) ? null : x);

// p-th percentile (0…100) of the values, linear between the closest ranks; null without values.
export const percentileOf = (values: number[], p: number): number | null => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
};

export class SampleBuffer {
  readonly capacity: number;
  readonly columns: Record<SampleField, Float64Array>;
  // Samples stored now (≤ capacity) and ever pushed.
  size = 0;
  total = 0;

  constructor(capacity = BUFFER_SECONDS) {
    this.capacity = capacity;
    this.columns = {} as Record<SampleField, Float64Array>;
    SAMPLE_FIELDS.forEach((field) => {
      this.columns[field] = new Float64Array(capacity);
    });
  }

  push(sample: SampleValues): void {
    const slot = this.total % this.capacity;
    SAMPLE_FIELDS.forEach((field) => {
      const value = sample[field];
      this.columns[field][slot] = value === null ? NaN : value;
    });
    this.total += 1;
    this.size = Math.min(this.size + 1, this.capacity);
  }

  // Ring slot of the i-th stored sample, 0 = the oldest.
  slot(i: number): number {
    return (this.total - this.size + i) % this.capacity;
  }

  at(field: SampleField, i: number): number | null {
    return toValue(this.columns[field][this.slot(i)]);
  }

  // The last n values, oldest first; fewer if the session is shorter.
  lastN(field: SampleField, n: number): (number | null)[] {
    const count = Math.min(n, this.size);
    const out: (number | null)[] = [];
    for (let i = this.size - count; i < this.size; i++) {
      out.push(this.at(field, i));
    }
    return out;
  }

  // Index (0 = the oldest) of the first stored sample with t ≥ from; size when there is none.
  firstAt(from: number): number {
    let low = 0;
    let high = this.size;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (this.columns.t[this.slot(middle)] < from) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    return low;
  }

  // Values of the samples with from ≤ t ≤ to (seconds from the session start).
  range(field: SampleField, from: number, to: number): (number | null)[] {
    const out: (number | null)[] = [];
    for (let i = this.firstAt(from); i < this.size; i++) {
      const t = this.columns.t[this.slot(i)];
      if (t > to) {
        break;
      }
      if (!Number.isNaN(t)) {
        out.push(this.at(field, i));
      }
    }
    return out;
  }

  // [from, to) split into `buckets` equal parts; min / max / mean of the values in each,
  // null for a bucket without values.
  downsample(field: SampleField, from: number, to: number, buckets: number): Buckets {
    const width = (to - from) / buckets;
    const result: Buckets = { t: [], min: [], max: [], mean: [] };
    const sums = new Array(buckets).fill(0);
    const counts = new Array(buckets).fill(0);
    const mins = new Array(buckets).fill(Infinity);
    const maxs = new Array(buckets).fill(-Infinity);

    for (let i = 0; i < this.size; i++) {
      const slot = this.slot(i);
      const t = this.columns.t[slot];
      const value = this.columns[field][slot];
      if (t < from || t >= to || Number.isNaN(value)) {
        continue;
      }
      const b = Math.min(buckets - 1, Math.floor((t - from) / width));
      sums[b] += value;
      counts[b] += 1;
      mins[b] = Math.min(mins[b], value);
      maxs[b] = Math.max(maxs[b], value);
    }

    for (let b = 0; b < buckets; b++) {
      result.t.push(from + b * width);
      result.min.push(counts[b] ? mins[b] : null);
      result.max.push(counts[b] ? maxs[b] : null);
      result.mean.push(counts[b] ? sums[b] / counts[b] : null);
    }
    return result;
  }

  // p-th percentile (0…100) of the non-null values, linear between the closest ranks;
  // from / to limit the time range.
  percentile(field: SampleField, p: number, from = -Infinity, to = Infinity): number | null {
    return percentileOf(this.range(field, from, to).filter((v): v is number => v !== null), p);
  }
}
