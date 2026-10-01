import React from "react";
import styles from "./Timeline.module.css";
import { WindowRange } from "./window";

const RANGES: { id: WindowRange; label: string }[] = [
  { id: "last2", label: "Last 2 min" },
  { id: "whole", label: "Whole session" },
];

interface WindowControlsProps {
  range: WindowRange;
  live: boolean;
  onRange: (range: WindowRange) => void;
  onLive: () => void;
}

// The window switch and the Live toggle (PRD §11.1). Live on — the window follows the time;
// a click brings it back to now.
export const WindowControls: React.FC<WindowControlsProps> = ({
  range, live, onRange, onLive,
}) => (
  <div className={styles.controls}>
    <div className={styles.segment} role="group">
      {RANGES.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={range === id}
          className={`${styles.segmentButton} ${range === id ? styles.segmentActive : ""}`}
          onClick={() => onRange(id)}
          data-range={id}
        >
          {label}
        </button>
      ))}
    </div>
    <button
      type="button"
      aria-pressed={live}
      className={`${styles.live} ${live ? styles.liveOn : ""}`}
      onClick={onLive}
      data-live={live}
    >
      <span className={styles.liveDot} aria-hidden="true" />
      Live
    </button>
  </div>
);
