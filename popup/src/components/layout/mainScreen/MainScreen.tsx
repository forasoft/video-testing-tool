import React from "react";
import styles from "./MainScreen.module.css";

export const MainScreen = () => (
  <div className={styles.mainScreenContent}>
    <div className={styles.toolPurpose}>
      With TestingTool, you can check any participant's stream and see video
      metrics values and trouble spots. You can also download a detailed
      statistics report with just one click.
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
  </div>
);
