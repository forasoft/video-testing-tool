// The status row at the top of Compact and Mini: how the session goes, in one line that opens the Report.
import React from "react";
import styles from "./StatusRow.module.css";
import { StatusInfo } from "../../../../shared/protocol";

interface StatusRowProps {
  status?: StatusInfo;
  // Mini (PRD §9.6): the dot and m:ss only.
  mini: boolean;
  // Opens Expanded on Report.
  onClick: () => void;
}

// Gray while collecting, green without problems, red when the stream is gone,
// otherwise the color of the problem's severity (PRD §9.1).
const tone = (status?: StatusInfo): string => {
  switch (status?.kind) {
    case "ok":
      return styles.green;
    case "disconnected":
      return styles.red;
    case "now":
    case "past":
      return status.severity === "severe" ? styles.red : styles.yellow;
    default:
      return styles.gray;
  }
};

// "3 problems · last 76s ago": the part before the first " · " is the headline.
const split = (text: string): [string, string] => {
  const at = text.indexOf(" · ");
  return at === -1 ? [text, ""] : [text.slice(0, at), text.slice(at)];
};

const Chevron = () => (
  <svg className={styles.chevron} width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M6 3.5 10.5 8 6 12.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

// Status row, PRD §9.1: the whole row is a button that opens Expanded on Report.
export const StatusRow: React.FC<StatusRowProps> = ({ status, mini, onClick }) => {
  const [headline, rest] = split(status?.text ?? "Collecting data…");

  if (mini) {
    return (
      <button type="button" className={`${styles.row} ${styles.mini} ${tone(status)}`} title="Open report" data-status={status?.kind ?? "collecting"} onClick={onClick}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.time}>{status?.time ?? "0:00"}</span>
      </button>
    );
  }

  return (
    <button type="button" className={`${styles.row} ${tone(status)}`} title="Open report" data-status={status?.kind ?? "collecting"} onClick={onClick}>
      <span className={styles.dot} aria-hidden="true" />
      <span className={styles.text}>
        {rest ? <strong className={styles.headline}>{headline}</strong> : headline}
        {rest}
      </span>
      <Chevron />
    </button>
  );
};
