import os from "node:os";
import { expectOnly, expectProblem } from "../lib/checks.js";
import { expect, test } from "../lib/fixtures.js";

// Plan T5.2: every row of plan §3 that needs no network shaping. Each scenario gives its problem type and category
// no later than 5 s after its condition ended (PRD §1, criterion 1), and no problem where there should be none.
// Scenarios with a problem are tagged @problem: `npm run e2e:repeat` runs them ×10.

// A problem is in the list this long after its condition ended.
const AFTER_CONDITION_MS = 5_000;
// The detectors compare with medians of the last 10 s, counted over at least 5 samples: scenarios start after this.
const WARMUP_MS = 12_000;
// WebRTC's own simulation of an overloaded CPU (plan §6): a strong machine does not limit the encoder by CPU.
const SIMULATED_OVERUSE = "--force-fieldtrials=WebRTC-ForceSimulatedOveruseIntervalMs/8000-15000-8000/";

test.describe("no-network", () => {
  test.beforeEach(() => {
    // A loaded machine drops frames by itself (plan §6): the load is kept with the result.
    test.info().annotations.push({ type: "load average", description: os.loadavg().map((v) => v.toFixed(1)).join(" ") });
  });

  test.afterEach(async ({ stand }) => {
    expect(stand.errors.extension(), "errors of the extension").toEqual([]);
  });

  test("Jank 400 ms → Page jank, Page", { tag: "@problem" }, async ({ stand }) => {
    await stand.start();
    await stand.testThisStream();
    await stand.page.waitForTimeout(WARMUP_MS);

    await stand.press("jankBtn");
    await expectProblem(stand, {
      name: "Page jank (Jank 400 ms)", type: "page_jank", category: "Page", oneLine: /^main thread blocked 4\d\d ms$/, timeout: 400 + AFTER_CONDITION_MS,
    });

    await stand.page.waitForTimeout(2_000);
    await expectOnly(stand, ["page_jank"]);
  });

  test.describe("with the simulated CPU overuse", () => {
    test.use({ browserArgs: [SIMULATED_OVERUSE] });

    // CPU burn itself does not make a 10-core machine limit the encoder by CPU (plan §6): WebRTC's simulation does,
    // ≈ 20 s after the call connects — for the receiver's own upload of the two-way call.
    test("CPU overuse (CPU burn on a weak machine) → Your upload limited by CPU, Sender", { tag: "@problem" }, async ({ stand }) => {
      await stand.start({ twoWay: true });
      await stand.testThisStream();

      const upload = await expectProblem(stand, {
        name: "Your upload limited by CPU (simulated overuse)", type: "upload_limited", category: "Sender", oneLine: /^cpu, \d+ s, [\d\u202f]+ of [\d\u202f]+ kbps$/, timeout: 45_000,
      });

      expect(upload.title).toBe("Your upload limited by CPU");
      // A starved CPU stalls audio and video too (plan T3.4): on a loaded machine they come along.
      await expectOnly(stand, ["upload_limited", "audio_stutter", "av_sync", "video_freeze"]);
    });
  });

  test("Freeze source 3 s → Video freeze, cause unknown, Device", { tag: "@problem" }, async ({ stand }) => {
    await stand.start();
    await stand.testThisStream();
    await stand.page.waitForTimeout(WARMUP_MS);

    await stand.press("freezeBtn");
    await expectProblem(stand, {
      name: "Video freeze, unknown (Freeze source 3 s)", type: "video_freeze", category: "Device", oneLine: /^\d+\.\d s, unknown$/, timeout: 3_000 + AFTER_CONDITION_MS, ok: (p) => p.tEnd !== null,
    });

    await stand.page.waitForTimeout(2_000);
    await expectOnly(stand, ["video_freeze"]);
  });

  test("Pause video 3 s → no problem, the paused seconds are grayed", async ({ stand }) => {
    await stand.start();
    await stand.testThisStream();
    await stand.page.waitForTimeout(WARMUP_MS);
    const before = await stand.sample();

    await stand.press("pauseBtn");
    await stand.page.waitForTimeout(3_000 + AFTER_CONDITION_MS);

    const hidden = await stand.page.evaluate(() => window.__vtt.series("hidden", 10));
    expect(hidden.filter((share) => share > 0.5).length).toBeGreaterThanOrEqual(2);
    // No freezes were added: the share of the session only falls as it goes on.
    expect((await stand.sample()).v_freeze_pct).toBeLessThanOrEqual(before.v_freeze_pct);
    await expectOnly(stand, []);
  });

  test("Hide tab 10 s → no problem, Tab hidden / Tab visible, the hidden seconds are grayed", async ({ stand }) => {
    await stand.start();
    await stand.testThisStream();
    await stand.page.waitForTimeout(WARMUP_MS);

    await stand.setTabHidden(true);
    await stand.page.waitForTimeout(10_000);
    await stand.setTabHidden(false);
    await stand.page.waitForTimeout(AFTER_CONDITION_MS);

    const kinds = (await stand.events()).map((e) => e.kind);
    expect(kinds).toEqual(expect.arrayContaining(["tab_hidden", "tab_visible"]));
    const hidden = await stand.page.evaluate(() => window.__vtt.series("hidden", 20));
    expect(hidden.filter((share) => share === 1).length).toBeGreaterThanOrEqual(8);
    await expectOnly(stand, []);
  });

  test("Blurry preset → Blurry picture, Sender", { tag: "@problem" }, async ({ stand }) => {
    await stand.start({ preset: "blurry", codec: "VP8" });
    await stand.testThisStream();

    // QP is bad from the first seconds; the detector needs 5 s of it.
    await expectProblem(stand, {
      name: "Blurry picture (Blurry preset)", type: "blurry", category: "Sender", oneLine: /^QP \d+ at 1080p, bitrate \d+ kbps$/, timeout: 20_000,
    });

    await expectOnly(stand, ["blurry"]);
  });

  test("No video for 6 s with Auto-start → Slow start, warn, Network", { tag: "@problem" }, async ({ stand }) => {
    await stand.start({ preset: "novideo", autoStart: true, twoWay: false });
    await stand.waitForState("live");

    // The condition ends with the first frame ≈ 6 s after the call connected.
    const slow = await expectProblem(stand, {
      name: "Slow start (No video for 6 s)", type: "slow_start", category: "Network", oneLine: /^first frame after [67]\.\d s$/, timeout: 7_000 + AFTER_CONDITION_MS, ok: (p) => p.tEnd !== null,
    });

    expect(slow.severity).toBe("warn");
    await expectOnly(stand, ["slow_start"]);
  });

  test("Desync preset → Audio / video out of sync, Device", { tag: "@problem" }, async ({ stand }) => {
    await stand.start({ preset: "desync" });
    await stand.testThisStream();

    // The stand raises the video jitter buffer once Chrome reports playout timestamps (≈ 10 s after connect).
    await stand.page.waitForFunction(() => window.stand.call.desynced, null, { timeout: 30_000 });
    // The offset is out of range 3 s in a row before the problem opens.
    await expectProblem(stand, {
      name: "Audio / video out of sync (Desync preset)", type: "av_sync", category: "Device", oneLine: /^audio ahead by \d+ ms$/, timeout: 3_000 + AFTER_CONDITION_MS,
    });

    // The jump of the buffer stops the video for ≈ 1 s as well (plan §6).
    await expectOnly(stand, ["av_sync", "video_freeze"]);
  });

  test("Close receiver PC → Disconnected", async ({ stand }) => {
    await stand.start();
    await stand.testThisStream();
    await stand.page.waitForTimeout(5_000);

    await stand.press("closeBtn");
    await stand.waitForState("disconnected", AFTER_CONDITION_MS);

    const panel = await stand.panel();
    await expect(panel.locator("[data-status=disconnected]")).toHaveText(/^Stream disconnected · 0:\d\d$/);
    await expectOnly(stand, []);
  });

  test("Add 2nd stream → a row in Other streams", async ({ stand }) => {
    await stand.start({ twoWay: false });
    await stand.testThisStream();

    await stand.press("secondBtn");
    // The table is polled every 5 s and needs two polls for a bitrate.
    await expect.poll(async () => ((await stand.streams()) ?? []).find((row) => !row.selected && row.bitrate > 0), {
      timeout: 10_000 + AFTER_CONDITION_MS,
    }).toBeTruthy();

    const rows = await stand.streams();
    expect(rows.map(({ name, selected }) => [name, selected])).toEqual([["Stream 1", true], ["Stream 2", false]]);
    expect([rows[1].w, rows[1].h]).toEqual([640, 360]);
    const panel = await stand.panel();
    await panel.locator("[data-status]").click();
    await expect(panel.locator("[data-other-streams] h3")).toHaveText("Other streams on this page (2)");
    await expectOnly(stand, []);
  });
});
