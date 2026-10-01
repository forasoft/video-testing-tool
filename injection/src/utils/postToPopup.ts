// Messages of the injection to the panel, the iframe that main.js adds to the page.
import { MESSAGES, PanelMessage } from "../../../shared/protocol";
import { findPanel } from "./senders";

// Messages posted inside postBatch(), waiting to go as one VTT_BATCH.
let batch: PanelMessage[] | null = null;

// To the panel's window, addressed to the extension's origin; before main.js adds the panel there is no one to tell.
const post = (message: unknown) => {
  const panel = findPanel();
  panel?.window.postMessage(message, panel.origin);
};

// Sends a message to the panel at once, or adds it to the batch being collected (postBatch).
export const postToPopup = (eventId: string, data: unknown) => {
  if (batch) {
    batch.push({ id: eventId, data });
    return;
  }
  post({ id: eventId, data });
};

// The messages that `send` posts go to the panel as one VTT_BATCH, in order: the panel hands them to its listeners in
// one task, so React draws them in one render (PRD §18: one render a second). A batch inside a batch joins it.
export const postBatch = (send: () => void): void => {
  if (batch) {
    send();
    return;
  }
  batch = [];
  try {
    send();
  } finally {
    const messages = batch;
    batch = null;
    if (messages.length === 1) {
      post(messages[0]);
    } else if (messages.length > 1) {
      post({ id: MESSAGES.VTT_BATCH, data: messages });
    }
  }
};
