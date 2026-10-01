// The chip of the session's verdict; its text and color come from verdictChip (verdict.ts).
import React from "react";
import styles from "./VerdictRow.module.css";
import { SessionState, VerdictInfo } from "../../../../shared/protocol";
import { verdictChip } from "./verdict";

interface VerdictChipProps {
  verdict?: VerdictInfo;
  state?: SessionState;
}

// Verdict chip, PRD §11.1: `● OK`, `● Degraded Σ s`, `● Severe Σ s` or `● Disconnected` — in the
// Timeline's verdict row and in the Report's Verdict card (§13.1).
export const VerdictChip: React.FC<VerdictChipProps> = ({ verdict, state }) => {
  const chip = verdictChip(verdict, state);

  return (
    <span className={`${styles.chip} ${styles[chip.tone]}`} data-verdict={chip.text}>
      <span className={styles.dot} aria-hidden="true" />
      {chip.text}
    </span>
  );
};
