import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findPanel, sentBy, thisPage } from "src/utils/senders";

const EXTENSION = "chrome-extension://iccaenpebpeacjofjkikdmeejlpeohma";
const PAGE = "https://meet.example.com";

// Who may post to the page's window: the panel's iframe, from the extension's origin, and the page itself.
describe("senders of the page's window messages", () => {
  const panelWindow = { name: "panel" } as unknown as Window;
  // The panel's iframe as main.js adds it; null — before it is added.
  let frame: { src: string; contentWindow: Window } | null;

  beforeEach(() => {
    frame = { src: `${EXTENSION}/index.html?page=${encodeURIComponent(PAGE)}`, contentWindow: panelWindow };
    vi.stubGlobal("document", { getElementById: (id: string) => (id === "vttFrame" ? frame : null) });
    vi.stubGlobal("window", { origin: PAGE });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("know the panel by its iframe: its window and the extension's origin; none before main.js adds it", () => {
    expect(findPanel()).toEqual({ window: panelWindow, origin: EXTENSION });

    frame = null;

    expect(findPanel()).toBeNull();
  });

  it("take a message only from the sender's window and origin", () => {
    const panel = findPanel();
    const otherFrame = {} as Window;

    expect(sentBy(panel, panelWindow, EXTENSION)).toBe(true);
    expect(sentBy(panel, otherFrame, EXTENSION)).toBe(false);
    expect(sentBy(panel, panelWindow, PAGE)).toBe(false);
    expect(sentBy(null, panelWindow, EXTENSION)).toBe(false);

    expect(sentBy(thisPage(), window, PAGE)).toBe(true);
    expect(sentBy(thisPage(), window, EXTENSION)).toBe(false);
    expect(sentBy(thisPage(), panelWindow, PAGE)).toBe(false);
  });
});
