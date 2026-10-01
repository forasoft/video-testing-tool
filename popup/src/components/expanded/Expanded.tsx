// Expanded: the panel's full view of a session, with the Timeline and Report tabs.
import React, { useContext } from "react";
import styles from "./Expanded.module.css";
import { DisplayContext } from "../../context/DisplayContext";
import { Header } from "./Header";
import { Timeline } from "./timeline/Timeline";
import { Report } from "../report/Report";

// Expanded, PRD §10: the header and the active tab under it; the tab scrolls, the panel does not.
export const Expanded: React.FC = () => {
  const { state: { tab } } = useContext(DisplayContext);

  return (
    <div className={styles.expanded} data-mode="expanded">
      <Header />
      <section className={styles.body} role="tabpanel" aria-label={tab === "timeline" ? "Timeline" : "Report"} data-tab={tab}>
        {tab === "timeline" && <Timeline />}
        {tab === "report" && <Report />}
      </section>
    </div>
  );
};
