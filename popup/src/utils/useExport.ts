// Export of the session to a file, for Export ▾ of the Expanded header and the Export buttons of the Report and the
// start screen; each of them shows its own `Preparing…`.
import {
  useCallback, useEffect, useState
} from "react";
import { ExportMessage, ExportReadyMessage, MESSAGES } from "../../../shared/protocol";
import { onPageMessage, postToWindow } from "./page";

// `json` — the full session, `csv` — the per-second samples.
export type ExportFormat = ExportMessage["format"];

// Without an answer in this long the button is usable again.
const READY_TIMEOUT_MS = 10000;

// Export of the session (PRD §15): the injection makes the file and downloads it; until it says that the file of
// this format is ready (VTT_EXPORT_READY), the button reads `Preparing…` and is inactive (§13.5).
export const useExport = () => {
  const [preparing, setPreparing] = useState<ExportFormat | null>(null);

  useEffect(() => onPageMessage((message) => {
    if (message.id === MESSAGES.VTT_EXPORT_READY) {
      const { format } = (message.data ?? {}) as Partial<ExportReadyMessage>;
      setPreparing((current) => (current === format ? null : current));
    }
  }), []);

  useEffect(() => {
    if (preparing === null) {
      return undefined;
    }
    const timer = setTimeout(() => setPreparing(null), READY_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [preparing]);

  const start = useCallback((format: ExportFormat) => {
    setPreparing(format);
    const message: ExportMessage = { format };
    postToWindow(MESSAGES.VTT_EXPORT, message);
  }, []);

  return { preparing, start };
};
