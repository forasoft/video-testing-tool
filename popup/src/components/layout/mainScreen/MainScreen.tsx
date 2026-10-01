import React, { useContext } from "react";
import styles from "./MainScreen.module.css";
import { SessionContext } from "../../../context/SessionContext";
import { ExportButton } from "../../export/ExportButton";
import { verdictChip } from "../../expanded/verdict";

interface MainScreenProps {
  // Why the last attempt to pick a stream failed (PRD §14.2); gone with the next attempt.
  error: string | null;
  // Opens the Report of the last session.
  onOpenReport: () => void;
}

// The session that ended on this page (PRD §14.1): `{hostname} · {m:ss} · {verdict}`, its Report and its JSON.
const LastSession: React.FC<Pick<MainScreenProps, "onOpenReport">> = ({ onOpenReport }) => {
  const { session, sample } = useContext(SessionContext);
  if (!session || (session.state !== "stopped" && session.state !== "disconnected")) {
    return null;
  }
  // The verdict of the session, not the `Disconnected` of its chip.
  const { text } = verdictChip(sample?.verdict, undefined);

  return (
    <section className={styles.lastSession} data-last-session>
      <span className={styles.stepsTitle}>Last session</span>
      <div className={styles.lastSessionCard}>
        <div className={styles.lastSessionLine} data-last-session-line>
          {`${session.hostname} · ${sample?.status?.time ?? "0:00"} · ${text}`}
        </div>
        <div className={styles.lastSessionButtons}>
          <button type="button" className={styles.openReport} onClick={onOpenReport} data-open-report>
            Open report
          </button>
          <ExportButton format="json" label="Export JSON" />
        </div>
      </div>
    </section>
  );
};

export const MainScreen: React.FC<MainScreenProps> = ({ error, onOpenReport }) => (
  <div className={styles.mainScreenContent}>
    <div className={styles.toolPurpose}>
      With StreamTest, you can check any participant’s stream and see video
      metrics and trouble spots. You can also download a detailed statistics
      report with just one click.
    </div>
    <div className={styles.steps}>
      <span className={styles.stepsTitle}>Steps</span>
      <div className={styles.step}>
        <div className={styles.stepNumber}>1.</div>
        {" "}
        Right-click any stream
        (except yours) on the page or tap the touchpad with two fingers while
        hovering over it
      </div>
      <div className={styles.step}>
        <div className={styles.stepNumber}>2.</div>
        <div>
          {" "}
          Select the “Test stream” option in the context menu
          <span className={styles.secondaryText}>
            {" "}
            (doesn’t work on a website with its own context menu)
          </span>
        </div>
      </div>
    </div>
    {error && (
      <p className={styles.error} role="alert" data-start-error>{error}</p>
    )}
    <LastSession onOpenReport={onOpenReport} />
  </div>
);
