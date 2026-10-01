// The Distribution card of the Report: the session's typical, bad and worst values against their targets.
import React from "react";
import styles from "./Report.module.css";
import { BUFFER_SECONDS } from "../../../../shared/constants/sampleFields";
import { Goodness, ReportMessage } from "../../../../shared/protocol";

interface DistributionProps {
  report: ReportMessage | null;
  // m:ss of the session.
  duration: string;
}

const TONES: Record<Goodness, string> = {
  good: styles.good,
  moderate: styles.moderate,
  bad: styles.bad,
};

// Distribution, PRD §13.3: typical and bad values of the session and the worst one in the color of §7. The rows
// come ready from VTT_REPORT; Freezes and First frame have one cell across typical, bad moments and worst.
export const Distribution: React.FC<DistributionProps> = ({ report, duration }) => (
  <section className={styles.card} data-distribution>
    <h3 className={styles.title}>Distribution</h3>
    {report?.truncatedFrom !== null && report?.truncatedFrom !== undefined && (
      <p className={styles.note} data-truncated>{`Showing the last ${BUFFER_SECONDS / 60} min of ${duration}`}</p>
    )}
    {report && (
      <table className={styles.table}>
        <colgroup>
          <col className={styles.metricColumn} />
          <col />
          <col />
          <col />
          <col className={styles.targetColumn} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={styles.metric}>Metric</th>
            <th scope="col">typical (p50)</th>
            <th scope="col">bad moments (p95 / p5)</th>
            <th scope="col">worst</th>
            <th scope="col">target</th>
          </tr>
        </thead>
        <tbody>
          {report.distribution.map(({
            metric, typical, bad, worst, goodness, target,
          }) => (
            <tr key={metric} data-metric-row={metric}>
              <th scope="row" className={styles.metric}>{metric}</th>
              {bad === undefined ? (
                <td colSpan={3} className={`${styles.wide} ${goodness ? TONES[goodness] : ""}`} data-cell="typical" data-goodness={goodness}>{typical}</td>
              ) : (
                <>
                  <td data-cell="typical">{typical}</td>
                  <td data-cell="bad">{bad}</td>
                  <td className={goodness ? TONES[goodness] : ""} data-cell="worst" data-goodness={goodness}>{worst}</td>
                </>
              )}
              <td data-cell="target">{target}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </section>
);
