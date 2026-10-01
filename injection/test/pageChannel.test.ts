import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGES, PanelMessage } from "shared/protocol";
import { onPageMessage, postToWindow } from "../../popup/src/utils/page";

type Listener = (event: unknown) => void;

const PAGE = "https://meet.example.com";
const EXTENSION = "chrome-extension://iccaenpebpeacjofjkikdmeejlpeohma";

// The panel's link to the page that shows it (popup/src/utils/page.ts): it takes messages from its parent window and
// the page's origin alone, and posts to the page addressed to that origin.
describe("the panel's messages with the page", () => {
  const parent = { postMessage: vi.fn() };
  let listeners: Listener[];

  // The panel at `search` of its address (main.js puts the page's origin there), itself of the extension's origin.
  const stubPanel = (search: string, origin = EXTENSION) => {
    vi.stubGlobal("window", {
      parent,
      origin,
      location: { search },
      addEventListener: (type: string, fn: Listener) => {
        if (type === "message") {
          listeners.push(fn);
        }
      },
      removeEventListener: (type: string, fn: Listener) => {
        listeners = listeners.filter((other) => type !== "message" || other !== fn);
      },
    });
  };

  const fire = (source: unknown, origin: string, data: unknown) => {
    listeners.forEach((fn) => fn({ source, origin, data }));
  };

  beforeEach(() => {
    listeners = [];
    parent.postMessage.mockClear();
    stubPanel(`?page=${encodeURIComponent(PAGE)}`);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("are taken from the parent window alone, from the page's origin, until the handler stops", () => {
    const received: PanelMessage[] = [];
    const stop = onPageMessage((message) => received.push(message));

    fire(parent, PAGE, { id: MESSAGES.VTT_SAMPLE, data: { t: 1 } });
    // Another frame of the page, and the parent window with another origin.
    fire({}, PAGE, { id: MESSAGES.VTT_SAMPLE, data: { t: 2 } });
    fire(parent, "https://ads.example.net", { id: MESSAGES.VTT_SAMPLE, data: { t: 3 } });
    // Not a message of the protocol.
    fire(parent, PAGE, "ready");
    stop();
    fire(parent, PAGE, { id: MESSAGES.VTT_SAMPLE, data: { t: 4 } });

    expect(received).toEqual([{ id: MESSAGES.VTT_SAMPLE, data: { t: 1 } }]);
    expect(listeners).toEqual([]);
  });

  it("of a second come as one VTT_BATCH and are handed to every handler one by one, in order", () => {
    const first: string[] = [];
    const second: string[] = [];
    const stops = [onPageMessage(({ id }) => first.push(id)), onPageMessage(({ id }) => second.push(id))];

    fire(parent, PAGE, {
      id: MESSAGES.VTT_BATCH,
      data: [
        { id: MESSAGES.VTT_PROBLEM, data: { id: 1 } },
        { id: MESSAGES.VTT_EVENT, data: { n: 2 } },
        { id: MESSAGES.VTT_SAMPLE, data: { t: 3 } },
      ],
    });
    stops.forEach((stop) => {
      stop();
    });

    expect(first).toEqual([MESSAGES.VTT_PROBLEM, MESSAGES.VTT_EVENT, MESSAGES.VTT_SAMPLE]);
    expect(second).toEqual(first);
  });

  it("go to the page's origin; a sandboxed page as \"*\"; opened alone, the panel is its own page", () => {
    postToWindow(MESSAGES.VTT_SET_MODE, { mode: "expanded" });
    expect(parent.postMessage).toHaveBeenLastCalledWith({ id: MESSAGES.VTT_SET_MODE, data: { mode: "expanded" } }, PAGE);

    stubPanel("?page=null");
    postToWindow(MESSAGES.VTT_MARK, {});
    expect(parent.postMessage).toHaveBeenLastCalledWith({ id: MESSAGES.VTT_MARK, data: {} }, "*");

    stubPanel("?mock=compact", "http://localhost:5173");
    postToWindow(MESSAGES.VTT_MARK);
    expect(parent.postMessage).toHaveBeenLastCalledWith({ id: MESSAGES.VTT_MARK, data: undefined }, "http://localhost:5173");
  });
});
