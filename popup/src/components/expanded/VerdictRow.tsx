import React from "react";
import styles from "./VerdictRow.module.css";
import { SessionState, VerdictInfo } from "../../../../shared/protocol";
import { VerdictChip } from "./VerdictChip";

interface VerdictRowProps {
  verdict?: VerdictInfo;
  state?: SessionState;
  // The window switch and Live, at the right of the row.
  children?: React.ReactNode;
}

// Verdict row of the Timeline, PRD §11.1: the chip of the worst problem's level and Σ of the problems'
// seconds, `Worst: {title} at {m:ss} — {one-line}` (or `No problems in {m:ss}`), then the controls.
export const VerdictRow: React.FC<VerdictRowProps> = ({ verdict, state, children }) => {
  const text = verdict?.text ?? "";

  return (
    <div className={styles.row} data-verdict-row>
      <VerdictChip verdict={verdict} state={state} />
      <span className={styles.text} title={text} data-verdict-text>{text}</span>
      {children}
    </div>
  );
};
