import React from "react";
import styles from "./ProblemCard.module.css";
import { ProblemMessage } from "../../../../shared/protocol";
import { ButtonTip } from "../icons/ButtonTip";
import { MiniChart } from "./MiniChart";
import {
  problemDuration, problemEnd, problemInterval
} from "./problems";

interface ProblemCardProps {
  problem: ProblemMessage;
  // Seconds from the session start: a problem that goes on lasts until now.
  now: number;
  onClose?: () => void;
}

// The card of a problem, PRD §12.2: what happened, when, how bad, the numbers, the likely cause
// and what to check. The texts come with the problem (VTT_PROBLEM); nothing is computed here.
export const ProblemCard: React.FC<ProblemCardProps> = ({ problem, now, onClose }) => {
  const {
    title, category, severity, card,
  } = problem;

  return (
    <div className={styles.content} data-problem-card={problem.id}>
      <div className={styles.header}>
        <span className={`${styles.dot} ${styles[`${severity}Dot`]}`} aria-hidden="true" />
        <span className={styles.title}>{title}</span>
        <span className={styles.category}>{category}</span>
        {onClose && (
          <button type="button" className={styles.close} aria-label="Close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
            <ButtonTip text="Close" />
          </button>
        )}
      </div>
      <div className={styles.time}>
        {`${problemInterval(problem)} · ${problemDuration(problem, now)} · ${severity}`}
      </div>
      <MiniChart card={card} severity={severity} from={problem.tStart} to={problemEnd(problem, now)} />
      <dl className={styles.rows}>
        {card.rows.map(([key, value]) => (
          <React.Fragment key={key}>
            <dt className={styles.key}>{key}</dt>
            <dd className={styles.value}>{value}</dd>
          </React.Fragment>
        ))}
      </dl>
      <dl className={styles.texts}>
        <dt className={styles.causeKey}>Likely cause</dt>
        <dd className={styles.cause}>{card.likelyCause}</dd>
        <dt className={styles.checkKey}>Check</dt>
        <dd className={styles.check}>{card.check}</dd>
      </dl>
    </div>
  );
};
