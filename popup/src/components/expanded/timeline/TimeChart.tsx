// One chart of the Timeline as SVG: Bitrate, Frame rate, Packet loss or Delay.
import React, { useRef } from "react";
import styles from "./Timeline.module.css";
import {
  areaPath, linePath, Point, TimeWindow
} from "./scale";
import { NUMBER_R, numberCenters } from "./numbers";
import { useWidth } from "./useWidth";

// A series of a chart: a line, an area under it, or both.
export interface ChartSeries {
  // What the series shows, unique in its chart: the key of its SVG group.
  key: string;
  points: Point[];
  color: string;
  // Fill down to 0 with this opacity: 0.12 under a line (PRD §11.2), 1 for a layer of the delay stack.
  fill?: number;
  // Line width, px; 0 — no line.
  line?: number;
  dashed?: boolean;
}

// A value of the y axis with its text: a scale label, or the limit line's.
interface AxisLabel {
  value: number;
  text: string;
}

// A vertical band over the whole height (PRD §11.2): the tab was hidden or the video paused,
// or a problem of that severity.
export interface ChartBand {
  // Unique among the chart's bands: `problem-{id}` or `hidden-{from}`.
  key: string;
  from: number;
  to: number;
  kind: "hidden" | "warn" | "severe";
  // The problem's number in the band's top-left corner (the Bitrate row).
  number?: number;
}

// Narrower bands would not be seen.
const MIN_BAND_PX = 2;

interface TimeChartProps {
  window: TimeWindow;
  height: number;
  // Top of the y axis; the bottom is 0.
  max: number;
  // Drawn in this order: the first one is at the back.
  series: ChartSeries[];
  // At the right edge, 9 px mono gray.
  labels?: AxisLabel[];
  // A red dashed line with its label at the left (Delay: 300 ms).
  limit?: AxisLabel;
  // Under the series.
  bands?: ChartBand[];
}

// One row's plot, PRD §11.2: the series over the window, two grid lines (the middle and 0),
// gaps where a value is null.
export const TimeChart: React.FC<TimeChartProps> = ({
  window, height, max, series, labels = [], limit, bands = [],
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const x = (t: number) => ((t - window.from) / (window.to - window.from)) * width;
  const y = (v: number) => height - (v / max) * height;

  return (
    <div ref={ref} className={styles.plot} style={{ height }}>
      {width > 0 && (
        <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
          {bands.map(({
            key, from, to, kind, number,
          }) => {
            // Whole pixels: in Whole session a band moves a fifth of a pixel a second, and an hour has up to 200
            // problems on each of the four rows — they are drawn again only when they cross a pixel (PRD §18).
            const left = Math.round(Math.max(0, x(from)));
            const right = Math.round(Math.min(width, x(to)));
            return right < 0 || left > width ? null : (
              <rect
                key={key}
                className={styles[kind]}
                x={left}
                y={0}
                width={Math.max(MIN_BAND_PX, right - left)}
                height={height}
                data-band={kind}
                data-problem={number}
              />
            );
          })}
          <line className={styles.grid} x1={0} x2={width} y1={height / 2} y2={height / 2} />
          <line className={styles.grid} x1={0} x2={width} y1={height - 0.5} y2={height - 0.5} />
          {series.map(({
            key, points, color, fill, line = 1.8, dashed,
          }) => (
            <g key={key}>
              {fill !== undefined && <path d={areaPath(points, x, y)} style={{ fill: color }} opacity={fill} />}
              {line > 0 && (
                <path
                  d={linePath(points, x, y)}
                  fill="none"
                  style={{ stroke: color }}
                  strokeWidth={line}
                  strokeDasharray={dashed ? "4 3" : undefined}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}
            </g>
          ))}
          {limit && (
            <g data-limit={limit.value}>
              <line className={styles.limit} x1={0} x2={width} y1={y(limit.value)} y2={y(limit.value)} />
              <text className={`${styles.axisLabel} ${styles.limitLabel}`} x={4} y={y(limit.value) - 3}>{limit.text}</text>
            </g>
          )}
          {numberCenters(bands.filter(({ to }) => x(to) >= 0), x).map((center) => {
            const kind = bands.find(({ number }) => number === center.number)?.kind;
            return center.x > width ? null : (
              <g key={`number-${center.number}`} data-problem-number={center.number}>
                <circle className={styles[`${kind}Number`]} cx={center.x} cy={center.y} r={NUMBER_R} />
                <text className={styles[`${kind}NumberText`]} x={center.x} y={center.y + 3} textAnchor="middle">{center.number}</text>
              </g>
            );
          })}
          {labels.map(({ value, text }) => (
            <text key={text} className={styles.axisLabel} x={width - 2} y={Math.max(9, y(value) - 3)} textAnchor="end">
              {text}
            </text>
          ))}
        </svg>
      )}
    </div>
  );
};
