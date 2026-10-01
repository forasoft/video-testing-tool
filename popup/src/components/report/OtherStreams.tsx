// The Other streams card of the Report: the page's received videos side by side.
import React from "react";
import styles from "./Report.module.css";
import { Goodness, StreamRow } from "../../../../shared/protocol";
import {
  formatKbps, formatPct, formatResolution
} from "../../utils/format";

const DOTS: Record<Goodness, string> = {
  good: styles.dotGood,
  moderate: styles.dotModerate,
  bad: styles.dotBad,
};

const show = (value: number | null, format: (v: number) => string): string => (value === null ? "—" : format(value));

interface OtherStreamsProps {
  rows: StreamRow[];
}

// Other streams on this page, PRD §13.4: every video stream the page receives, the selected one marked; the dot
// has the worst grade of the row, the name's tooltip — its track and mid. Only when there are other streams; the
// rows come every 5 s (VTT_STREAMS) and are not clickable.
export const OtherStreams: React.FC<OtherStreamsProps> = ({ rows }) => {
  if (!rows.some((row) => !row.selected)) {
    return null;
  }

  return (
    <section className={styles.card} data-other-streams>
      <h3 className={styles.title}>{`Other streams on this page (${rows.length})`}</h3>
      <table className={styles.table}>
        <colgroup>
          <col className={styles.metricColumn} />
          <col />
          <col />
          <col />
          <col />
          <col className={styles.targetColumn} />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={styles.metric}>Stream</th>
            <th scope="col">Resolution</th>
            <th scope="col">Bitrate</th>
            <th scope="col">Loss</th>
            <th scope="col">Freezes</th>
            <th scope="col" aria-label="selected" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id} data-stream-row={row.name} data-selected={row.selected}>
              <th scope="row" className={`${styles.metric} ${styles.stream}`}>
                <span className={styles.streamName} tabIndex={0} aria-describedby={`vtt-stream-${row.id}`}>
                  {row.name}
                  <span className={`${styles.streamDot} ${row.goodness ? DOTS[row.goodness] : ""}`} data-goodness={row.goodness} aria-hidden="true" />
                </span>
                <span id={`vtt-stream-${row.id}`} role="tooltip" className={styles.streamTooltip}>{row.tooltip}</span>
              </th>
              <td data-cell="resolution">{row.w !== null && row.h !== null ? formatResolution(row.w, row.h) : "—"}</td>
              <td data-cell="bitrate">{show(row.bitrate, formatKbps)}</td>
              <td data-cell="loss">{show(row.loss, formatPct)}</td>
              <td data-cell="freezes">{show(row.freezes, formatPct)}</td>
              <td className={styles.selectedMark}>{row.selected ? "selected" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
