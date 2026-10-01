// Fixtures of every test: Chromium with the extension of build/ in a fresh profile, and the stand open in it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium, test as base } from "@playwright/test";
import { BUILD } from "./paths.js";
import { Stand } from "./stand.js";

// `test` with these fixtures: the specs import it and `expect` from here instead of @playwright/test.
export const test = base.extend({
  // More Chromium flags for the tests of a file: test.use({ browserArgs: [...] }).
  browserArgs: [[], { option: true }],

  context: async ({ browserArgs }, use) => {
    // The profile (tens of MB) is kept out of the project: a synced or indexed folder would churn on it.
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "streamtest-e2e-"));
    const context = await chromium.launchPersistentContext(profile, {
      // The full Chromium: its headless mode loads extensions.
      channel: "chromium",
      headless: !process.env.HEADED,
      viewport: { width: 1400, height: 900 },
      args: [
        `--disable-extensions-except=${BUILD}`,
        `--load-extension=${BUILD}`,
        "--autoplay-policy=no-user-gesture-required",
        // The Direct route without TURN (plan §6): LAN host candidates need the camera permission and no mDNS names.
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        "--disable-features=WebRtcHideLocalIpsWithMdns",
        ...browserArgs,
      ],
    });
    await use(context);
    await context.close();
    fs.rmSync(profile, { recursive: true, force: true });
  },

  // The stand open in that browser; after the test its network is cleaned and its calls are closed.
  stand: async ({ context }, use) => {
    const stand = await Stand.open(context);
    await use(stand);
    await stand.close();
  },
});

export { expect } from "@playwright/test";
