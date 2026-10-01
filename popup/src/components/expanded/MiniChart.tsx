// The chart of a problem card: the problem's series in the samples around it.
import React from "react";
import styles from "./ProblemCard.module.css";
import { groupThousands } from "../../../../shared/format";
import { ProblemCard, Severity } from "../../../../shared/protocol";
import {
  areaPath, linePath, nice, Point
} from "./timeline/scale";

const WIDTH = 368;
const HEIGHT = 64;
// Bars of long tasks (PRD §12.4, Page jank): the scale is 0…max(400, longest) ms, a dashed line at 50 ms.
const BARS_MIN_MAX_MS = 400;
const LONG_TASK_MS = 50;

// Series of the card charts by their sample field; the rest are blue.
const COLORS: Record<string, string> = {
  v_fps_r: "var(--green)",
  v_loss: "var(--red)",
  a_concealed_pct: "var(--red)",
};

interface MiniChartProps {
  card: ProblemCard;
  severity: Severity;
  // The problem, seconds from the session start; it may go on until `to`.
  from: number;
  to: number;
}

const toPoints = (points: [number, number | null][]): Point[] => points.map(([t, v]) => ({ t, v }));

// The chart of a problem card, PRD §12.2: 368 × 64, one series (and its dashed partner) over the
// problem ± 15 s, the problem's band behind it.
export const MiniChart: React.FC<MiniChartProps> = ({
  card, severity, from, to,
}) => {
  const bars = card.series.kind === "bars";
  const series = toPoints(card.series.points);
  const dashed = card.dashed ? toPoints(card.dashed.points) : [];
  const values = [...series, ...dashed].map(({ v }) => v).filter((v): v is number => v !== null);
  const low = bars ? 0 : Math.min(0, ...values);
  const high = bars ? Math.max(BARS_MIN_MAX_MS, ...values) : nice(Math.max(0, ...values) * 1.15) || 1;
  const start = from - 15;
  const end = Math.max(to + 15, ...series.map(({ t }) => t));
  const x = (t: number) => ((t - start) / (end - start)) * WIDTH;
  const y = (v: number) => HEIGHT - ((v - low) / (high - low)) * HEIGHT;
  const color = COLORS[card.series.name] ?? "var(--blue)";

  return (
    <svg className={styles.chart} width={WIDTH} height={HEIGHT} viewBox={`0 0 ${WIDTH} ${HEIGHT}`} aria-hidden="true" data-mini-chart={card.series.name}>
      <rect className={styles[severity]} x={x(from)} y={0} width={Math.max(2, x(to) - x(from))} height={HEIGHT} data-band />
      <line className={styles.grid} x1={0} x2={WIDTH} y1={y(0) - 0.5} y2={y(0) - 0.5} />
      {bars ? (
        <>
          {series.filter((p): p is { t: number; v: number } => p.v !== null).map(({ t, v }) => (
            // A task is as wide as it lasted, at least 2 px, and as tall as its duration.
            <rect key={t} x={x(t)} y={y(v)} width={Math.max(2, x(t + v / 1000) - x(t))} height={HEIGHT - y(v)} style={{ fill: color }} data-bar={v} />
          ))}
          <line className={styles.limit} x1={0} x2={WIDTH} y1={y(LONG_TASK_MS)} y2={y(LONG_TASK_MS)} />
        </>
      ) : (
        <>
          <path d={areaPath(series, x, y)} style={{ fill: color }} opacity={0.12} />
          <path d={linePath(series, x, y)} fill="none" style={{ stroke: color }} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
      {dashed.length > 0 && (
        <path d={linePath(dashed, x, y)} fill="none" style={{ stroke: "var(--gray)" }} strokeWidth={1.2} strokeDasharray="4 3" />
      )}
      <text className={styles.axisLabel} x={WIDTH - 2} y={9} textAnchor="end">{high >= 10 ? groupThousands(high) : String(high)}</text>
    </svg>
  );
};
