// Drawing helpers of the timeline charts (PRD §11.2): the time window, round axis maxima,
// time labels and SVG paths with gaps where there is no data.

// A time window, seconds from the session start.
export interface TimeWindow {
  from: number;
  to: number;
}

// A value at a time, seconds from the session start; null — no data, a gap in the line.
export interface Point {
  t: number;
  v: number | null;
}

// Pixels of a point.
type Scale = (value: number) => number;

// Round maxima m × 10^k: their halves (the middle label) are round too.
const STEPS = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

// The smallest round number ≥ value; 0 for no value.
export const nice = (value: number): number => {
  if (!(value > 0)) {
    return 0;
  }
  const power = 10 ** Math.floor(Math.log10(value));
  const step = STEPS.find((m) => m * power >= value * (1 - 1e-9)) as number;
  return Number((step * power).toPrecision(12));
};

// "Last 2 min" ends now; while the session is shorter, it shows the whole session (PRD §11.1).
export const lastWindow = (now: number, span = 120): TimeWindow => ({
  from: Math.max(0, now - span),
  to: Math.max(now, 1),
});

// Times of the axis labels: multiples of `step` inside the window.
export const ticks = ({ from, to }: TimeWindow, step: number): number[] => {
  const out: number[] = [];
  // `|| 0`: the first label of a window from 0 would be −0.
  for (let t = Math.ceil(from / step - 1e-9) * step || 0; t <= to + 1e-9; t += step) {
    out.push(t);
  }
  return out;
};

// The largest value of the points inside the window; 0 without values.
export const maxIn = ({ from, to }: TimeWindow, ...series: Point[][]): number =>
  series.flat().reduce((max, { t, v }) => (v !== null && t >= from && t <= to && v > max ? v : max), 0);

// Runs of consecutive points with values: a null breaks the line (PRD §11.2).
export const runs = (points: Point[]): { t: number; v: number }[][] => {
  const out: { t: number; v: number }[][] = [];
  let run: { t: number; v: number }[] = [];
  points.forEach(({ t, v }) => {
    if (v === null) {
      if (run.length) {
        out.push(run);
      }
      run = [];
      return;
    }
    run.push({ t, v });
  });
  if (run.length) {
    out.push(run);
  }
  return out;
};

const xy = (x: Scale, y: Scale, t: number, v: number) => `${x(t).toFixed(1)} ${y(v).toFixed(1)}`;

// The line through each run; a lone point is a dot thanks to the round line cap.
export const linePath = (points: Point[], x: Scale, y: Scale): string =>
  runs(points)
    .map((run) => (run.length === 1
      ? `M${xy(x, y, run[0].t, run[0].v)}h0.01`
      : run.map(({ t, v }, i) => `${i ? "L" : "M"}${xy(x, y, t, v)}`).join("")))
    .join("");

// The area between each run and the baseline (y of 0).
export const areaPath = (points: Point[], x: Scale, y: Scale): string =>
  runs(points)
    .map((run) => {
      const first = run[0];
      const last = run[run.length - 1];
      return `M${xy(x, y, first.t, 0)}${run.map(({ t, v }) => `L${xy(x, y, t, v)}`).join("")}L${xy(x, y, last.t, 0)}Z`;
    })
    .join("");
