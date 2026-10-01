// End-to-end tests of the extension on the stand (plan T5.1–T5.3): Chromium with build/ loaded, the stand's
// loopback call, the scenario buttons of plan §3.
//
//   npm run e2e                      all tests
//   npm run e2e -- --grep smoke      one group
//   HEADED=1 npm run e2e             with a browser window
//
// The stand is started here if it is not running (http://localhost:8080); network tests also need TURN
// (`npm run stand:turn`). One test at a time: the calls share the stand's network shaper and the machine's CPU.
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 120_000,
  expect: { timeout: 10_000 },
  workers: 1,
  fullyParallel: false,
  // Real codecs on a loaded machine now and then miss a threshold (plan §6): a test is tried up to 3 times.
  // `npm run e2e:repeat` counts without retries.
  retries: 2,
  reporter: [["list"]],
  globalSetup: "./global-setup.js",
  outputDir: "./test-results",
  webServer: {
    command: "node stand/server.mjs",
    cwd: "..",
    url: "http://localhost:8080/api/turn",
    reuseExistingServer: true,
    timeout: 15_000,
  },
});
