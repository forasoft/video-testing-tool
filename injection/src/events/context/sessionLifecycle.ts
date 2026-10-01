// One listener per session for the window messages that stop it (PRD §14.3).
import { messageId } from "shared/protocol";
import { CONSTS } from "../../consts/events";
import { findPanel, sentBy, thisPage } from "src/utils/senders";

interface IRegisterSessionMessageHandlerProps {
  stopCalculation: () => void;
}

// The messages that end a session: another stream picked, Close, Back to main (PRD §14.3).
const STOPPING_MESSAGES: string[] = [CONSTS.VTT_CONTEXT_BTN_CLICK, CONSTS.VTT_HIDE, CONSTS.VTT_STOP_CALCULATION];

// Close, Back to main or another stream picked stop the session (PRD §14.3). They come from the page itself (main.js,
// background.js, the stand) or from the panel (Back to main, Close in Expanded).
export const registerSessionMessageHandler = (
  props: IRegisterSessionMessageHandlerProps
): void => {
  const { stopCalculation } = props;

  const callback = (e: MessageEvent<unknown>) => {
    const id = messageId(e);
    if (id === undefined || !STOPPING_MESSAGES.includes(id)) {
      return;
    }
    if (sentBy(thisPage(), e.source, e.origin) || sentBy(findPanel(), e.source, e.origin)) {
      stopCalculation();
      window.removeEventListener("message", callback, false);
    }
  };

  window.addEventListener("message", callback, false);
};
