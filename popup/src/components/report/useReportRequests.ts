// The Report's requests for its data (VTT_GET_REPORT) while it is open.
import { useEffect } from "react";
import { GetReportMessage, MESSAGES, SessionState } from "../../../../shared/protocol";
import { postToWindow } from "../../utils/page";

// The Report's percentiles are asked for when the tab opens and every 5 s while it is open (PRD §6.2).
const REPORT_REFRESH_MS = 5000;

// VTT_GET_REPORT → VTT_REPORT (PRD §21); the answer goes to SessionContext. Asked again at once when the session
// ends: the verdict above is final then, and the table must not lag it by up to 5 s. The refreshes are answered with
// the next sample, so that the panel draws both at once (PRD §18).
export const useReportRequests = (state: SessionState | undefined): void => {
  useEffect(() => {
    const ask = (message: GetReportMessage) => postToWindow(MESSAGES.VTT_GET_REPORT, message);
    ask({});
    const timer = setInterval(() => ask({ refresh: true }), REPORT_REFRESH_MS);
    return () => clearInterval(timer);
  }, [state]);
};
