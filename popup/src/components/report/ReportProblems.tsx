import React, { useContext } from "react";
import styles from "./Report.module.css";
import listStyles from "../expanded/ProblemsList.module.css";
import { ProblemMessage } from "../../../../shared/protocol";
import { ReportContext } from "../../context/ReportContext";
import { ProblemCard } from "../expanded/ProblemCard";
import { problemDuration, problemInterval } from "../expanded/problems";

interface ReportProblemsProps {
  problems: ProblemMessage[];
  // Seconds from the session start: a problem that goes on lasts until now.
  now: number;
}

const Chevron = () => (
  <svg className={listStyles.chevron} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3.5 6 8 10.5 12.5 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Problems of the Report, PRD §13.2: the rows of the Timeline's list (§11.4) in time order; a click opens
// the problem's card (§12.2) under its row, another click closes it; any of them can be open at once.
export const ReportProblems: React.FC<ReportProblemsProps> = ({ problems, now }) => {
  const { expanded, toggle } = useContext(ReportContext);
  const sorted = [...problems].sort((a, b) => a.tStart - b.tStart || a.id - b.id);

  return (
    <section className={styles.card} data-report-problems>
      <h3 className={styles.title}>{`Problems (${problems.length})`}</h3>
      {sorted.length ? (
        <div className={styles.problems}>
          {sorted.map((problem) => {
            const open = expanded.includes(problem.id);
            return (
              <React.Fragment key={problem.id}>
                <button
                  type="button"
                  className={`${listStyles.row} ${open ? styles.open : ""}`}
                  aria-expanded={open}
                  onClick={() => toggle(problem.id)}
                  data-problem-id={problem.id}
                >
                  <span className={`${listStyles.dot} ${listStyles[problem.severity]}`} aria-hidden="true" />
                  <span className={listStyles.interval}>{problemInterval(problem)}</span>
                  <span className={listStyles.name}>{problem.title}</span>
                  <span className={listStyles.duration}>{problemDuration(problem, now)}</span>
                  <span className={listStyles.category}>{problem.category}</span>
                  <Chevron />
                </button>
                {open && (
                  <div className={styles.inlineCard} data-inline-card={problem.id}>
                    <ProblemCard problem={problem} now={now} />
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      ) : (
        <div className={styles.empty}>No problems</div>
      )}
    </section>
  );
};
