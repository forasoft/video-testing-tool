import React, { useContext } from "react";
import styles from "./Report.module.css";
import { mmss } from "../../../../shared/format";
import { SessionContext } from "../../context/SessionContext";
import { ExportButton } from "../export/ExportButton";
import { Distribution } from "./Distribution";
import { OtherStreams } from "./OtherStreams";
import { ReportProblems } from "./ReportProblems";
import { useViewPerf } from "../../utils/perf";
import { useReportRequests } from "./useReportRequests";
import { VerdictCard } from "./VerdictCard";

// Report tab, PRD §13: the verdict for a ticket, every problem with its card, the Distribution of the session and
// the other streams of the page, one card under another; the files of the session at the bottom (§13.5).
export const Report: React.FC = () => {
  useViewPerf("report");
  const {
    session, sample, problems, report, streams,
  } = useContext(SessionContext);
  useReportRequests(session?.state);

  return (
    <div className={styles.report} data-report>
      <VerdictCard />
      <ReportProblems problems={problems} now={sample?.t ?? 0} />
      <Distribution report={report} duration={sample?.status?.time ?? mmss(sample?.t ?? 0)} />
      <OtherStreams rows={streams} />
      <div className={styles.exports} data-report-exports>
        <ExportButton format="json" label="Export JSON" />
        <ExportButton format="csv" label="Export CSV" />
      </div>
    </div>
  );
};
