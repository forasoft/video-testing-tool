// Messages of the extension's background script, which reach the page as window messages.
import { messageId } from "shared/protocol";
import { sentBy, thisPage } from "src/utils/senders";

interface IProps<T> {
  eventId: string;
  handler: (payload: T) => void;
}

// Calls `handler` for every `eventId` message the page's own window posts: background.js sends the clicks on the
// context menu item and the toolbar button this way (chrome.scripting runs window.postMessage in the tab).
const addBackgroundMessageHandler = <T = unknown>(props: IProps<T>) => {
  const { handler, eventId } = props;

  window.addEventListener("message", (event: MessageEvent<unknown>) => {
    if (!sentBy(thisPage(), event.source, event.origin) || messageId(event) !== eventId) {
      return;
    }
    handler((event.data as { payload: T }).payload);
  });
};

export default addBackgroundMessageHandler;
