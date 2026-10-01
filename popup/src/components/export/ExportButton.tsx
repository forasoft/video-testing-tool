// The plain export button of the Report and of the start screen's last session.
import React from "react";
import styles from "../expanded/ExportMenu.module.css";
import { ExportFormat, useExport } from "../../utils/useExport";

interface ExportButtonProps {
  format: ExportFormat;
  // `Export JSON` / `Export CSV`.
  label: string;
}

// A button that downloads one file of the session (PRD §13.5, §14.1): `Preparing…` and inactive while the
// injection makes it.
export const ExportButton: React.FC<ExportButtonProps> = ({ format, label }) => {
  const { preparing, start } = useExport();
  const busy = preparing === format;

  return (
    <button
      type="button"
      className={styles.button}
      disabled={busy}
      onClick={() => start(format)}
      data-export-button={format}
      data-export={busy ? "preparing" : "idle"}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M8 2.5v8m0 0L4.75 7.25M8 10.5l3.25-3.25M3 13.5h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {busy ? "Preparing…" : label}
    </button>
  );
};
