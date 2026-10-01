import { expect, test } from "../lib/fixtures.js";

// Plan T5.1: the extension on the stand — a session goes live, a sample comes every second, the panel shows it, and
// the page's console has no errors. On the default route (TURN udp when TURN runs) and on Direct, which the tests
// without network shaping use when TURN does not run.
for (const route of [undefined, "direct"]) {
  test(`smoke${route ? ` on the ${route} route` : ""}: a live session sends samples, the panel shows it, no page errors`, async ({ stand }) => {
    const used = await stand.start({ route });
    test.info().annotations.push({ type: "route", description: used });

    await stand.testThisStream();
    const first = await stand.waitForSample((s) => s.v_bitrate > 0 && s.v_fps_r > 0);
    await stand.page.waitForTimeout(3000);
    const later = await stand.sample();

    expect(await stand.state()).toBe("live");
    expect(later.t - first.t).toBeGreaterThanOrEqual(2);
    expect(later.v_bitrate).toBeGreaterThan(0);
    const panel = await stand.panel();
    await expect(panel.locator("[data-status]")).toBeVisible();
    expect(await stand.problems()).toEqual([]);
    expect(stand.errors.all()).toEqual([]);
  });
}
