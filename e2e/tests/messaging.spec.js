/* global chrome -- the extension's API in its service worker, where worker.evaluate() runs a function */
import { expect, test } from "../lib/fixtures.js";

// Another origin than the stand's (http://localhost:8080), served by the same stand: a third-party frame of the page.
const FOREIGN_URL = "http://127.0.0.1:8080/api/turn";

// The page, main.js and the panel take each other's messages only from each other's windows and origins (PRD §21):
// the header buttons, the panel's height, its requests, Back to main, both Close buttons and the toolbar button work,
// while another frame of the page can neither stop the session, nor hide the panel, nor show it an error.
test("messages of the page and the panel pass, another frame's do not", async ({ stand, context }) => {
  const { page } = stand;
  const container = page.locator("#vttFrameContainer");
  const headerButton = (label) => container.locator(`[aria-label="${label}"]`).first();
  const hidden = async () => (await container.getAttribute("class")).includes("VTT_displayNone");

  await stand.start();
  await stand.testThisStream();
  await stand.waitForSample((s) => s.v_bitrate > 0);
  const panel = await stand.panel();

  // The panel tells main.js that a session is shown (VTT_IS_MAIN_SCREEN) and how tall it is (VTT_CONTENT_HEIGHT).
  await expect(headerButton("Open timeline")).toBeVisible();
  await expect.poll(() => page.$eval("#vttFrame", (frame) => parseFloat(frame.style.height) || 0)).toBeGreaterThan(100);

  // Another frame posts what main.js, the injection and the panel act on: none of them takes it.
  await page.evaluate((url) => new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.onload = resolve;
    document.body.append(frame);
  }), FOREIGN_URL);
  const foreign = page.frames().find((frame) => frame.url() === FOREIGN_URL);
  await foreign.evaluate(() => {
    const spoofed = [
      { id: "VTT_HIDE" },
      { id: "VTT_STOP_CALCULATION" },
      { id: "VTT_EXTENSION_BUTTON_CLICK" },
      { id: "VTT_GO_TO_MAIN_SCREEN", data: { error: "Spoofed" } },
    ];
    // To the page's window and to every frame of it, the panel among them.
    for (const message of spoofed) {
      window.top.postMessage(message, "*");
      for (let i = 0; i < window.top.length; i++) {
        window.top[i].postMessage(message, "*");
      }
    }
  });
  await page.waitForTimeout(1500);
  expect(await stand.state()).toBe("live");
  expect(await hidden()).toBe(false);
  await expect(panel.locator("[data-start-error]")).toHaveCount(0);
  await expect(panel.locator("[data-status]")).toBeVisible();

  // Open timeline: main.js sizes the panel and tells it the mode; Collapse to compact asks main.js for the mode back.
  await headerButton("Open timeline").click();
  await expect(panel.locator('[data-mode="expanded"] [data-tab="timeline"]')).toBeVisible();
  // A request of the panel and the injection's answer: the Report's Distribution comes with VTT_GET_REPORT.
  await panel.getByRole("tab", { name: "Report" }).click();
  await expect(panel.locator("[data-distribution] [data-metric-row]").first()).toBeVisible();
  await panel.locator('[aria-label="Collapse to compact"]').click();
  await expect(panel.locator('[data-mode="expanded"]')).toHaveCount(0);
  await expect(headerButton("Open timeline")).toBeVisible();
  // main.js narrows the panel in 0.3 s: a click lands where it aims once the panel stands at Compact's 350 px.
  await expect.poll(() => page.$eval("#vttFrame", (frame) => frame.getBoundingClientRect().width)).toBe(350);

  // Back to main: the panel stops the session and shows the start screen, main.js hides the session buttons.
  await panel.locator('[aria-label="Back to main"]').click();
  await stand.waitForState("stopped");
  await expect(headerButton("Open timeline")).toBeHidden();

  // Close of main.js's header, posted to the page's own window: the panel is hidden and the session stops.
  await stand.testThisStream();
  await expect(headerButton("Open timeline")).toBeVisible();
  await headerButton("Close").click();
  await stand.waitForState("stopped");
  expect(await hidden()).toBe(true);

  // The toolbar button, posted to the page from the extension's world as background.js does: the panel shows again.
  const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"));
  await worker.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ url: "http://localhost:8080/*" });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (data) => window.postMessage(data),
      args: [{ id: "VTT_EXTENSION_BUTTON_CLICK" }],
    });
  });
  await expect.poll(hidden).toBe(false);

  // Close of Expanded, posted by the panel: the panel is hidden and the session stops.
  await stand.testThisStream();
  await headerButton("Open timeline").click();
  await panel.locator('[data-mode="expanded"] [aria-label="Close"]').click();
  await stand.waitForState("stopped");
  await expect.poll(hidden).toBe(true);

  expect(stand.errors.all()).toEqual([]);
});
