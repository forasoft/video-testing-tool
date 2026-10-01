// Requests of the popup to the injection (PRD §21, popup → injection). They are answered for the
// latest session, also after it was disconnected or stopped: its data is kept until the page is left.
import { EVENTS } from "shared/constants/events";
import {
  ExportReadyMessage, GetHistoryMessage, MESSAGES, PanelPerfMessage, SummaryTextMessage,
} from "shared/protocol";
import { downloadFile } from "src/utils/downloadFile";
import { getDataUrl } from "src/utils/getDataUrl";
import { postToPopup } from "src/utils/postToPopup";
import { sessionCsv } from "./export/csv";
import { ExportFormat, exportFilename, jsonText, sessionJson } from "./export/json";
import { panelAnswered } from "./perf";
import { getActiveSession, getLastSession } from "./session";

const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

const isFormat = (value: unknown): value is ExportFormat => value === "json" || value === "csv";

// The latest session as a file (PRD §15): downloaded through a Blob URL (plan §4, 7), then the popup
// is told that it is ready. null without a session.
export const exportSession = (format: ExportFormat): ExportReadyMessage | null => {
  const session = getLastSession();
  if (!session) {
    return null;
  }
  const source = session.exportSource();
  const filename = exportFilename(source.hostname, source.startedAt, format);
  const url = format === "json"
    ? getDataUrl({ data: jsonText(sessionJson(source)), mimeType: "application/json" })
    : getDataUrl({ data: sessionCsv(source), mimeType: "text/csv;charset=utf-8" });
  downloadFile({ url, fileName: filename });
  const message: ExportReadyMessage = { format, url, filename };
  postToPopup(MESSAGES.VTT_EXPORT_READY, message);
  return message;
};

export const handlePopupRequest = (id: unknown, data: unknown): void => {
  // A periodic refresh is answered right before the next sample, a request of the tester's at once.
  const refresh = (data as { refresh?: unknown } | null)?.refresh === true;
  if (id === MESSAGES.VTT_GET_HISTORY) {
    const session = getLastSession();
    const { from, to, buckets } = (data ?? {}) as Partial<GetHistoryMessage>;
    if (session && isTime(from) && isTime(to) && from <= to) {
      const request = { from, to, buckets: isTime(buckets) ? buckets : undefined, refresh };
      const answer = () => postToPopup(MESSAGES.VTT_HISTORY, session.history(request));
      if (refresh) {
        session.withNextSample(answer);
      } else {
        answer();
      }
    }
  }
  if (id === MESSAGES.VTT_GET_REPORT) {
    const session = getLastSession();
    if (session) {
      const answer = () => postToPopup(MESSAGES.VTT_REPORT, session.report());
      if (refresh) {
        session.withNextSample(answer);
      } else {
        answer();
      }
    }
  }
  if (id === MESSAGES.VTT_COPY_SUMMARY) {
    const session = getLastSession();
    if (session) {
      const message: SummaryTextMessage = { text: session.summary() };
      postToPopup(MESSAGES.VTT_SUMMARY_TEXT, message);
    }
  }
  if (id === MESSAGES.VTT_MARK) {
    getActiveSession()?.mark();
  }
  if (id === MESSAGES.VTT_PERF && data) {
    panelAnswered(data as PanelPerfMessage);
  }
  const format = (data as { format?: unknown } | null)?.format;
  if (id === MESSAGES.VTT_EXPORT && isFormat(format)) {
    exportSession(format);
  }
};

// Only the panel's own iframe asks: the page's scripts post to the same window. Download logs in the
// header of Compact / Mini (main.js) downloads the JSON (PRD §8.2).
export const registerPopupRequests = (): void => {
  window.addEventListener("message", (event) => {
    const panel = (window.frames as unknown as { vttFrame?: Window }).vttFrame;
    if (panel && event.source === panel) {
      handlePopupRequest(event.data?.id, event.data?.data);
    }
  });
  window.addEventListener(EVENTS.VTT_DOWNLOAD_BUTTON_CLICK, () => exportSession("json"));
};
