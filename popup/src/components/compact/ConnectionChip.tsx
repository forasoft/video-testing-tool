import React from "react";
import styles from "./ConnectionChip.module.css";
import { ConnectionInfo } from "../../../../shared/protocol";

interface ConnectionChipProps {
  connection?: ConnectionInfo;
  // Opens Expanded on Timeline.
  onClick: () => void;
}

// Connection chip of the codecs row, PRD §9.3: a dot of the path goodness and the candidate type;
// the tooltip lists the local and remote candidates and the TURN server.
export const ConnectionChip: React.FC<ConnectionChipProps> = ({ connection, onClick }) => {
  if (!connection?.type) {
    return null;
  }

  const tone = connection.goodness ? styles[connection.goodness] : "";

  return (
    <span className={styles.wrapper} data-connection-chip>
      <button type="button" className={`${styles.chip} ${tone}`} aria-describedby="vtt-connection-tooltip" onClick={onClick}>
        <span className={styles.dot} aria-hidden="true" />
        {connection.type}
      </button>
      {connection.tooltip.length > 0 && (
        <span id="vtt-connection-tooltip" role="tooltip" className={styles.tooltip}>
          {connection.tooltip.map((line) => (
            <span key={line} className={styles.line}>{line}</span>
          ))}
        </span>
      )}
    </span>
  );
};
