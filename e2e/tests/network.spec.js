import os from "node:os";
import { expectOnly, expectProblem, recordCheck } from "../lib/checks.js";
import { expect, test } from "../lib/fixtures.js";

// Plan T5.3: the rows of plan §3 that shape the network — on the TURN udp route, through the stand's shaper. Each
// scenario gives its problem and cause no later than 5 s after its condition ended (PRD §1, criterion 1). Shaping
// also brings other real problems of phase 3 (plan §6: Audio stutter, A/V out of sync, freezes of the lost packets):
// they are allowed; types that shaping cannot make (Page jank, Blurry, Slow start …) are not.

const AFTER_CONDITION_MS = 5_000;
// Bandwidth drop compares with the median of the last 30 s (at least 5 samples): shaping starts after this.
const WARMUP_MS = 15_000;
// Consequences of lost and late packets that every shaping scenario may bring along; the shaped link is this
// machine's uplink of the two-way call too.
const CONSEQUENCES = ["video_freeze", "audio_stutter", "av_sync", "upload_limited"];

test.describe("network", () => {
  test.beforeEach(async ({ stand }) => {
    test.skip(!(await stand.turnUp()), "TURN is not running: npm run stand:turn");
    test.info().annotations.push({ type: "load average", description: os.loadavg().map((v) => v.toFixed(1)).join(" ") });
  });

  test.afterEach(async ({ stand }) => {
    expect(stand.errors.extension(), "errors of the extension").toEqual([]);
  });

  test("Throttle 300 kbit 10 s → Bandwidth drop, Network (severe if the layer fell); your upload limited by bandwidth, Sender", { tag: "@problem" }, async ({ stand }) => {
    await stand.start({ route: "turn-udp", twoWay: true });
    await stand.testThisStream();
    await stand.page.waitForTimeout(WARMUP_MS);

    await stand.net("throttle300");
    await expectProblem(stand, {
      name: "Bandwidth drop (Throttle 300 kbit)", type: "bandwidth_drop", category: "Network", timeout: 10_000 + AFTER_CONDITION_MS,
    });
    await expectProblem(stand, {
      name: "Your upload limited by bandwidth (Throttle 300 kbit, two-way)",
      type: "upload_limited",
      category: "Sender",
      oneLine: /^bandwidth, \d+ s, [\d\u202f]+ of [\d\u202f]+ kbps$/,
      timeout: 10_000 + AFTER_CONDITION_MS,
    });

    // The drop ends when the bitrate is back or the layer goes up — on the stand ≈ 35 s after the throttle (plan T1.10).
    const drop = await stand.waitForProblem("bandwidth_drop", { timeout: 90_000, ok: (p) => p.tEnd !== null });
    const layerDown = (await stand.events()).some((e) => e.kind === "layer_change" && e.tone === "yellow" && e.t >= drop.tStart && e.t <= drop.tEnd);
    recordCheck("Bandwidth drop severe when the layer fell (Throttle 300 kbit)", !layerDown || drop.severity === "severe", `${drop.severity}, layer fell: ${layerDown}, ${drop.oneLine}`);
    expect(!layerDown || drop.severity === "severe", `${drop.severity}: ${drop.oneLine}`).toBe(true);
    await expectOnly(stand, ["bandwidth_drop", ...CONSEQUENCES]);
  });

  test("Blackout 3 s → Video freeze, cause network, Network", { tag: "@problem" }, async ({ stand }) => {
    await stand.start({ route: "turn-udp" });
    await stand.testThisStream();
    await stand.page.waitForTimeout(WARMUP_MS);

    await stand.net("blackout3");
    // In the list during the blackout already; its cause is final once the next frame came (a key frame after it).
    await stand.waitForProblem("video_freeze", { timeout: 3_000 + AFTER_CONDITION_MS });
    await expectProblem(stand, {
      name: "Video freeze, network (Blackout 3 s)", type: "video_freeze", category: "Network", oneLine: /^\d+\.\d s, network$/, timeout: 15_000, ok: (p) => p.tEnd !== null,
    });

    // ICE notices a lost connection after 5–7 s: a 3 s blackout is no Reconnection.
    await stand.page.waitForTimeout(2_000);
    await expectOnly(stand, CONSEQUENCES);
  });

  test("Blackout 8 s → Reconnection, severe, Network", { tag: "@problem" }, async ({ stand }) => {
    await stand.start({ route: "turn-udp" });
    await stand.testThisStream();
    await stand.page.waitForTimeout(WARMUP_MS);

    await stand.net("blackout8");
    await stand.waitForProblem("reconnection", { timeout: 8_000 + AFTER_CONDITION_MS });
    const reconnection = await expectProblem(stand, {
      name: "Reconnection (Blackout 8 s)", type: "reconnection", category: "Network", severity: "severe", oneLine: /^\d+\.\d s$/, timeout: 15_000, ok: (p) => p.tEnd !== null,
    });

    // It starts with the last packet before the blackout.
    expect(reconnection.tEnd - reconnection.tStart).toBeGreaterThan(6);
    expect(reconnection.tEnd - reconnection.tStart).toBeLessThan(12);
    expect((await stand.events()).map((e) => e.kind)).toContain("reconnect");
    expect(await stand.state()).toBe("live");
    await expectOnly(stand, ["reconnection", ...CONSEQUENCES]);
  });

  test("Blackout 40 s → Reconnection not recovered, Disconnected", { tag: "@problem" }, async ({ stand }) => {
    await stand.start({ route: "turn-udp" });
    await stand.testThisStream();
    await stand.page.waitForTimeout(WARMUP_MS);

    await stand.net("blackout40");
    // Not recovered 30 s after the last packet: the session is disconnected.
    await stand.waitForState("disconnected", 30_000 + AFTER_CONDITION_MS + 5_000);
    await expectProblem(stand, {
      name: "Reconnection not recovered (Blackout 40 s)", type: "reconnection", category: "Network", severity: "severe", oneLine: /^\d+\.\d s, not recovered$/, timeout: 1_000, ok: (p) => p.tEnd !== null,
    });

    const panel = await stand.panel();
    await expect(panel.locator("[data-status=disconnected]")).toHaveText(/^Stream disconnected · \d:\d\d$/);
    await expectOnly(stand, ["reconnection", ...CONSEQUENCES]);
  });

  test("Loss 20 % → Audio stutter, Network (severe)", { tag: "@problem" }, async ({ stand }) => {
    await stand.start({ route: "turn-udp" });
    await stand.testThisStream();
    await stand.page.waitForTimeout(WARMUP_MS);

    await stand.net("loss20");
    // The concealed share of a 5 s window goes above 5 %.
    await expectProblem(stand, {
      name: "Audio stutter (Loss 20 %)", type: "audio_stutter", category: "Network", oneLine: /^\d+\.\d % concealed$/, timeout: 7_000 + AFTER_CONDITION_MS,
    });

    // Severe needs a peak above 20 %: with 20 % loss it is 21–22 %, a margin of 1–2 points (plan §6) — counted by
    // e2e:repeat, not failed here.
    await stand.page.waitForTimeout(15_000);
    const stutter = (await stand.problems()).find((p) => p.type === "audio_stutter");
    recordCheck("Audio stutter severe (Loss 20 %)", stutter.severity === "severe", `${stutter.severity}, ${stutter.oneLine}`);
    await stand.net("clean");
    await expectOnly(stand, ["bandwidth_drop", ...CONSEQUENCES]);
  });

  test("Block UDP → relay tcp → Connection path changed → relay · tcp, Network", { tag: "@problem" }, async ({ stand }) => {
    await stand.start({ route: "turn-udp" });
    await stand.testThisStream();
    await stand.page.waitForTimeout(WARMUP_MS);

    await stand.press("relayBtn");
    // ICE restarts on TURN tcp and moves in ≈ 3–4 s (plan T3.2).
    await expectProblem(stand, {
      name: "Connection path changed → relay · tcp (Block UDP)", type: "path_changed", category: "Network", oneLine: /^→ relay · tcp, RTT \d+ → \d+ ms$/, timeout: 4_000 + AFTER_CONDITION_MS,
    });

    expect((await stand.events()).map((e) => e.label)).toContain("Path → relay");
    await stand.page.waitForTimeout(2_000);
    await expectOnly(stand, ["path_changed", ...CONSEQUENCES]);
  });
});
