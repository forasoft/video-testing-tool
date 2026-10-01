import { MESSAGES, PanelMessage } from "../../../shared/protocol";

// Messages posted inside postBatch(), waiting to go as one VTT_BATCH.
let batch: PanelMessage[] | null = null;

const post = (message: unknown) => {
  (window.frames as unknown as { vttFrame: Window }).vttFrame.postMessage(message, "*");
};

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
