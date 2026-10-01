// The windows whose messages the injection takes: the panel's iframe and the page itself. A message counts only when
// both its window and its origin are the sender's, so other frames of the page cannot pose as either.

// A window that posts messages to the page, and the origin its messages come from.
export interface Sender {
  window: Window;
  origin: string;
}

// The id main.js gives the panel's iframe.
const PANEL_FRAME_ID = "vttFrame";

// The panel: the iframe main.js adds to the page, and the extension's origin it is loaded from; null until main.js
// adds it. The origin is put together from the scheme and the host: outside Chrome, URL.origin of a
// chrome-extension: address is "null".
export const findPanel = (): Sender | null => {
  const frame = document.getElementById(PANEL_FRAME_ID) as HTMLIFrameElement | null;
  if (!frame?.contentWindow) {
    return null;
  }
  const { protocol, host } = new URL(frame.src);
  return { window: frame.contentWindow, origin: `${protocol}//${host}` };
};

// The page itself: main.js (Close in its header), background.js (chrome.scripting posts the clicks in the tab) and
// the stand post to the page's own window.
export const thisPage = (): Sender => ({ window, origin: window.origin });

// Whether a message was posted by `sender`: by its window, from its origin.
export const sentBy = (sender: Sender | null, source: MessageEventSource | null, origin: string): boolean =>
  sender !== null && source === sender.window && origin === sender.origin;
