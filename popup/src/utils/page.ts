// The panel's link to the page that shows it, where main.js and the injection listen: the panel posts to its parent
// window and takes messages from that window alone, from the page's origin, so that other frames cannot pose as it.
import { MESSAGES, PanelMessage, panelMessage } from "../../../shared/protocol";

type Handler = (message: PanelMessage) => void;

// The page's origin: main.js puts it into the panel's address (`?page=`). Opened alone (`vite dev`), the panel is its
// own page.
const pageOrigin = (): string => new URLSearchParams(window.location.search).get("page") ?? window.origin;

// Posts a message to the page. postMessage cannot address an opaque origin ("null", a sandboxed page): such a page is
// addressed as "*", which still reaches it alone, as the parent of a frame does not change.
export const postToWindow = (eventId: string, data?: unknown): void => {
  const origin = pageOrigin();
  window.parent.postMessage({ id: eventId, data }, origin === "null" ? "*" : origin);
};

const handlers = new Set<Handler>();

// Hands a message to every handler. A second's VTT_BATCH (PRD §18) is unpacked within this task, so that React
// draws all of its messages in one render.
const deliver = (message: PanelMessage): void => {
  if (message.id === MESSAGES.VTT_BATCH && Array.isArray(message.data)) {
    (message.data as PanelMessage[]).forEach(deliver);
    return;
  }
  handlers.forEach((handler) => {
    handler(message);
  });
};

// The page's messages: posted by the parent window, from the page's origin.
const onMessage = (event: MessageEvent<unknown>): void => {
  if (event.source !== window.parent || event.origin !== pageOrigin()) {
    return;
  }
  const message = panelMessage(event);
  if (message) {
    deliver(message);
  }
};

// Calls `handler` with every message of the page until the returned function is called — a React effect's cleanup.
export const onPageMessage = (handler: Handler): (() => void) => {
  if (handlers.size === 0) {
    window.addEventListener("message", onMessage);
  }
  handlers.add(handler);
  return () => {
    handlers.delete(handler);
    if (handlers.size === 0) {
      window.removeEventListener("message", onMessage);
    }
  };
};
