import React, { useContext } from "react";
import styles from "./Header.module.css";
import { CONST } from "../../CONST/const";
import { DisplayContext } from "../../context/DisplayContext";
import { SessionContext } from "../../context/SessionContext";
import { ExpandedTab } from "../../../../shared/protocol";
import { postToWindow } from "../../utils/postToWindow";
import { ButtonTip } from "../icons/ButtonTip";
import { MarkButton } from "../mark/MarkButton";
import { ExportMenu } from "./ExportMenu";
import { connectionLine } from "./verdict";

const TABS: { id: ExpandedTab; label: string }[] = [
  { id: "timeline", label: "Timeline" },
  { id: "report", label: "Report" },
];

// State chip, PRD §8.3: `● m:ss` while recording; `Stopped m:ss` / `Disconnected m:ss` — when it ended.
const StateChip: React.FC = () => {
  const { session, sample } = useContext(SessionContext);
  const time = <span className={styles.time}>{sample?.status?.time ?? "0:00"}</span>;

  switch (session?.state) {
    case "disconnected":
      return <span className={`${styles.chip} ${styles.red}`} data-state="disconnected">Disconnected {time}</span>;
    case "stopped":
      return <span className={`${styles.chip} ${styles.gray}`} data-state="stopped">Stopped {time}</span>;
    default:
      return (
        <span className={`${styles.chip} ${styles.green}`} data-state="live">
          <span className={styles.dot} aria-hidden="true" />
          {time}
        </span>
      );
  }
};

// Connection line, PRD §8.3: codecs, candidate types, protocol and RTT of the selected pair; the
// tooltip lists the local and remote candidates and the TURN server.
const ConnectionLine: React.FC = () => {
  const { sample } = useContext(SessionContext);
  const connection = sample?.connection;
  if (!connection) {
    return null;
  }

  return (
    <span className={styles.connection} data-connection-line>
      <span className={styles.line} tabIndex={0} aria-describedby={connection.tooltip.length ? "vtt-connection-line-tooltip" : undefined}>
        {connectionLine(connection, sample?.goodness.rtt).map(({ text, goodness, plain }, i) => (
          // The parts of the line are fixed by their place in it.
          <span key={i} className={`${plain ? "" : styles.value} ${goodness ? styles[goodness] : ""}`}>{text}</span>
        ))}
      </span>
      {connection.tooltip.length > 0 && (
        <span id="vtt-connection-line-tooltip" role="tooltip" className={styles.tooltip}>
          {connection.tooltip.map((line) => (
            <span key={line} className={styles.tooltipLine}>{line}</span>
          ))}
        </span>
      )}
    </span>
  );
};

// Header of Expanded, PRD §8.3. It is also the handle that drags the panel: main.js moves it.
export const Header: React.FC = () => {
  const { state: { tab }, setMode, setTab } = useContext(DisplayContext);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as Element).closest("button, [role=menu]")) {
      return;
    }
    e.preventDefault();
    postToWindow(CONST.VTT_DRAG_START, { clientX: e.clientX, clientY: e.clientY });
  };

  return (
    <header className={styles.header} onPointerDown={onPointerDown} data-expanded-header>
      <span className={styles.title}>StreamTest</span>
      <StateChip />
      <div className={styles.tabs} role="tablist">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            className={`${styles.tab} ${tab === id ? styles.active : ""}`}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      <ConnectionLine />
      <span className={styles.spacer} />
      <MarkButton size="header" />
      <ExportMenu />
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Collapse to compact"
        onClick={() => setMode("compact")}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M13 3 9.2 6.8M9.2 6.8V3.9M9.2 6.8h2.9M3 13l3.8-3.8m0 0v2.9m0-2.9H3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <ButtonTip text="Collapse to compact" />
      </button>
      <button
        type="button"
        className={styles.iconButton}
        aria-label="Close"
        onClick={() => postToWindow(CONST.VTT_HIDE, {})}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
        <ButtonTip text="Close" />
      </button>
    </header>
  );
};
