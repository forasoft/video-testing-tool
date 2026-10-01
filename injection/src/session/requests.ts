// Requests of the popup to the injection (PRD §21, popup → injection). They are answered for the
// latest session, also after it was disconnected or stopped: its data is kept until the page is left.
import { EVENTS } from "shared/constants/events";
import {
  ExportReadyMessage, GetHistoryMessage, MESSAGES, PanelPerfMessage, SummaryTextMessage, panelMessage,
} from "shared/protocol";
import { downloadFile } from "src/utils/downloadFile";
import { getDataUrl } from "src/utils/getDataUrl";
import { postToPopup } from "src/utils/postToPopup";
import { findPanel, sentBy } from "src/utils/senders";
import { sessionCsv } from "./export/csv";
import { ExportFormat, exportFilename, jsonText, sessionJson } from "./export/json";
import { panelAnswered } from "./perf";
import { Session, getActiveSession, getLastSession } from "./session";

// A finite number: the times of a request are checked before they are used.
const isTime = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

// The formats VTT_EXPORT may ask for.
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

// Answers at once, or — for the panel's periodic refresh — right before the next sample (PRD §18).
const answerWhen = (session: Session, refresh: boolean, answer: () => void) => {
  if (refresh) {
    session.withNextSample(answer);
  } else {
    answer();
  }
};

// A request's handler: its data, and whether it is the panel's periodic refresh.
type RequestHandler = (data: unknown, refresh: boolean) => void;

// The panel's requests by id. A Map, not an object: an id such as "toString" must not find anything.
const HANDLERS = new Map<string, RequestHandler>([
  [MESSAGES.VTT_GET_HISTORY, (data, refresh) => {
    const session = getLastSession();
    const { from, to, buckets } = (data ?? {}) as Partial<GetHistoryMessage>;
    if (session && isTime(from) && isTime(to) && from <= to) {
      const request = { from, to, buckets: isTime(buckets) ? buckets : undefined, refresh };
      answerWhen(session, refresh, () => postToPopup(MESSAGES.VTT_HISTORY, session.history(request)));
    }
  }],
  [MESSAGES.VTT_GET_REPORT, (_data, refresh) => {
    const session = getLastSession();
    if (session) {
      answerWhen(session, refresh, () => postToPopup(MESSAGES.VTT_REPORT, session.report()));
    }
  }],
  [MESSAGES.VTT_COPY_SUMMARY, () => {
    const session = getLastSession();
    if (session) {
      const message: SummaryTextMessage = { text: session.summary() };
      postToPopup(MESSAGES.VTT_SUMMARY_TEXT, message);
    }
  }],
  [MESSAGES.VTT_MARK, () => {
    getActiveSession()?.mark();
  }],
  [MESSAGES.VTT_PERF, (data) => {
    if (data) {
      panelAnswered(data as PanelPerfMessage);
    }
  }],
  [MESSAGES.VTT_EXPORT, (data) => {
    const format = (data as { format?: unknown } | null)?.format;
    if (isFormat(format)) {
      exportSession(format);
    }
  }],
]);

// A request of the panel; an unknown id is ignored.
export const handlePopupRequest = (id: unknown, data: unknown): void => {
  const handler = typeof id === "string" ? HANDLERS.get(id) : undefined;
  // A periodic refresh is answered right before the next sample, a request of the tester's at once.
  const refresh = (data as { refresh?: unknown } | null)?.refresh === true;
  handler?.(data, refresh);
};

// Only the panel asks — its iframe's window, from the extension's origin: the page's scripts post to the same window.
// Download logs in the header of Compact / Mini (main.js) downloads the JSON (PRD §8.2).
export const registerPopupRequests = (): void => {
  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    const message = panelMessage(event);
    if (message && sentBy(findPanel(), event.source, event.origin)) {
      handlePopupRequest(message.id, message.data);
    }
  });
  window.addEventListener(EVENTS.VTT_DOWNLOAD_BUTTON_CLICK, () => exportSession("json"));
};
