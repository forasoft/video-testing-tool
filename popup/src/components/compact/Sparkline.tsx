import React from "react";
import styles from "./Sparkline.module.css";
import { Goodness } from "../../../../shared/protocol";

const WIDTH = 54;
const HEIGHT = 16;
const STROKE = 1.5;

interface SparklineProps {
  // The last 120 s, oldest first; null — no data (a gap in the line).
  values: (number | null)[];
  goodness?: Goodness;
}

// SVG path of the values on a 0…max scale; every run of values between nulls is a separate line.
export const sparklinePath = (values: (number | null)[]): string => {
  const max = values.reduce<number>((m, v) => (v !== null && v > m ? v : m), 0);
  const step = values.length > 1 ? WIDTH / (values.length - 1) : 0;
  // Keep the whole stroke inside the box.
  const y = (v: number) => (HEIGHT - STROKE / 2 - (max > 0 ? (v / max) * (HEIGHT - STROKE) : 0)).toFixed(2);
  let path = "";
  let inRun = false;

  values.forEach((v, i) => {
    if (v === null) {
      inRun = false;
      return;
    }
    const x = (i * step).toFixed(2);
    const next = values[i + 1];
    if (!inRun && (next === null || next === undefined)) {
      // A lone point: a dot thanks to the round line cap.
      path += `M${x} ${y(v)}h0.01`;
    } else {
      path += `${inRun ? "L" : "M"}${x} ${y(v)}`;
    }
    inRun = true;
  });

  return path;
};

// Tile sparkline, PRD §9.2: 54 × 16, 1.5 px line of the current goodness color, opacity 0.75.
export const Sparkline: React.FC<SparklineProps> = ({ values, goodness }) => (
  <svg
    className={styles.sparkline}
    width={WIDTH}
    height={HEIGHT}
    viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
    aria-hidden="true"
    data-sparkline
  >
    <path
      className={goodness ? styles[goodness] : styles.none}
      d={sparklinePath(values)}
      fill="none"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      opacity={0.75}
    />
  </svg>
);
