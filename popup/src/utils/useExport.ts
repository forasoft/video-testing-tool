import {
  useCallback, useEffect, useState
} from "react";
import { ExportMessage, ExportReadyMessage, MESSAGES } from "../../../shared/protocol";
import { postToWindow } from "./postToWindow";

export type ExportFormat = ExportMessage["format"];

// Without an answer in this long the button is usable again.
export const READY_TIMEOUT_MS = 10000;

// Export of the session (PRD §15): the injection makes the file and downloads it; until it says that the file of
// this format is ready (VTT_EXPORT_READY), the button reads `Preparing…` and is inactive (§13.5).
export const useExport = () => {
  const [preparing, setPreparing] = useState<ExportFormat | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.data?.id === MESSAGES.VTT_EXPORT_READY) {
        const { format } = (e.data.data ?? {}) as Partial<ExportReadyMessage>;
        setPreparing((current) => (current === format ? null : current));
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, []);

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
