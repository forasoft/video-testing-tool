// Chrome Web Store assets (store/README.md): the package ZIP, the small promo tile and the screenshots of the
// extension of build/ on the stand dressed as a video call.
// Needs `npm run build`, TURN (`npm run stand:turn`) and Playwright (`npm run e2e:install`). `--zip` makes only the ZIP.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildDir = path.join(root, "build");
const storeDir = path.join(root, "store");
const shotsDir = path.join(storeDir, "screenshots");
// A stand of its own on other ports: the capture's network presets must not reach a call on the default stand.
const STAND_ENV = { STAND_PORT: "8095", SHAPER_PORT: "3495", SHAPER2_PORT: "3496" };
const STAND_URL = `http://localhost:${STAND_ENV.STAND_PORT}/`;
// The store takes screenshots of exactly 1280×800 and a small promo tile of 440×280.
const SCREEN = { width: 1280, height: 800 };
const TILE = { width: 440, height: 280 };
// The Report compares a run with the previous one on the site if that one lasted ≥ 30 s (PRD §13.1).
const PREVIOUS_RUN_MS = 33_000;
// Before the drop the sparklines of Compact (the last 120 s) are almost full.
const BEFORE_DROP_MS = 100_000;

function packageZip() {
  const { version } = JSON.parse(fs.readFileSync(path.join(buildDir, "manifest.json"), "utf8"));
  const zip = path.join(storeDir, `streamtest-${version}.zip`);
  fs.rmSync(zip, { force: true });
  // The manifest at the root of the archive; Finder's .DS_Store files stay out.
  execFileSync("zip", ["-r", "-X", "-q", zip, ".", "-x", "*.DS_Store"], { cwd: buildDir });
  console.log(`${path.relative(root, zip)} — ${(fs.statSync(zip).size / 1024).toFixed(0)} KB`);
}

async function promoTile(context) {
  const logo = fs.readFileSync(path.join(root, "popup", "public", "logo512.png")).toString("base64");
  const page = await context.newPage();
  await page.setViewportSize(TILE);
  await page.setContent(`<!doctype html>
<style>
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  .tile { position: relative; width: 440px; height: 280px; overflow: hidden; color: #fff;
    background: linear-gradient(135deg, #3b79ff 0%, #2c68fa 45%, #1d4cc9 100%); }
  .logo { position: absolute; left: 34px; top: 58px; width: 116px; height: 116px; filter: brightness(0) invert(1); }
  .name { position: absolute; left: 172px; top: 72px; font-size: 42px; font-weight: 700; letter-spacing: -0.5px; }
  .tag { position: absolute; left: 174px; top: 128px; width: 236px; font-size: 17px; line-height: 23px; opacity: 0.92; }
  svg { position: absolute; left: 0; bottom: 0; }
</style>
<div class="tile">
  <img class="logo" src="data:image/png;base64,${logo}" alt="">
  <div class="name">StreamTest</div>
  <div class="tag">See why a WebRTC video stream looks bad</div>
  <svg width="440" height="64" viewBox="0 0 440 64">
    <path d="M0 30 L40 26 L80 29 L120 24 L160 28 L200 25 L236 27 L256 50 L276 55 L296 53 L316 36 L340 29 L380 26 L440 28 L440 64 L0 64 Z"
      fill="rgba(255,255,255,0.10)"/>
    <path d="M0 30 L40 26 L80 29 L120 24 L160 28 L200 25 L236 27 L256 50 L276 55 L296 53 L316 36 L340 29 L380 26 L440 28"
      fill="none" stroke="rgba(255,255,255,0.45)" stroke-width="2.5" stroke-linejoin="round"/>
  </svg>
</div>`);
  await page.evaluate(() => document.images[0].decode());
  const file = path.join(storeDir, "promo-440x280.png");
  await page.locator(".tile").screenshot({ path: file });
  await page.close();
  console.log(path.relative(root, file));
}

// The stand as a video call: the receiver video fills the window, the stand's own controls are hidden.
const CALL_CSS = `
  html, body { height: 100%; }
  body { margin: 0; overflow: hidden; background: #0e1014; }
  .topbar, .column, .previews, #secondCard, .stage > section.card { display: none !important; }
  .layout { display: block !important; margin: 0 !important; padding: 0 !important; }
  .stage > .card:first-child { position: fixed; inset: 0; margin: 0; padding: 0; border: 0; border-radius: 0;
    background: #0e1014; box-shadow: none; }
  .stage > .card:first-child .cardHead { display: none; }
  #remoteVideo { position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none;
    aspect-ratio: auto; border-radius: 0; object-fit: contain; background: #0e1014; }
  .callName { position: fixed; left: 24px; bottom: 32px; padding: 7px 12px; border-radius: 8px; color: #fff;
    background: rgba(20, 22, 26, 0.72); font: 500 14px -apple-system, BlinkMacSystemFont, sans-serif; }
  .callBar { position: fixed; left: 50%; bottom: 20px; display: flex; gap: 12px; padding: 10px 14px;
    transform: translateX(-50%); border-radius: 999px; background: rgba(32, 34, 40, 0.88); }
  .callBar span { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 22px; background: #3b3e46; }
  .callBar span.leave { width: 64px; background: #e5484d; }
  .callBar svg { width: 22px; height: 22px; fill: #fff; }
`;

const CALL_BAR = `
  <span><svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/>
    <path d="M6 11a6 6 0 0 0 12 0" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
    <rect x="11" y="17" width="2" height="4" rx="1"/></svg></span>
  <span><svg viewBox="0 0 24 24"><rect x="3" y="7" width="12" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3z"/></svg></span>
  <span><svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="12" rx="2" fill="none" stroke="#fff" stroke-width="2"/>
    <rect x="9" y="19" width="6" height="2" rx="1"/></svg></span>
  <span class="leave"><svg viewBox="0 0 24 24">
    <path d="M3 13.5c5-4.7 13-4.7 18 0l-2.2 2.6-3.3-1.3v-2.2a9.5 9.5 0 0 0-7 0v2.2l-3.3 1.3z"/></svg></span>
`;

async function dressAsCall(page) {
  await page.addStyleTag({ content: CALL_CSS });
  await page.evaluate((bar) => {
    const name = document.createElement("div");
    name.className = "callName";
    name.textContent = "Remote participant";
    const controls = document.createElement("div");
    controls.className = "callBar";
    controls.innerHTML = bar;
    document.body.append(name, controls);
  }, CALL_BAR);
}

// A one-way call on the TURN udp route (the network presets shape it); TURN udp now and then does not connect.
async function startCall(page) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    await page.evaluate(() => {
      if (window.stand.call) {
        window.stand.stopCall();
      }
      const set = (id, value) => {
        const control = document.getElementById(id);
        if (control.type === "checkbox") {
          control.checked = value;
        } else {
          control.value = value;
        }
        control.dispatchEvent(new Event("change", { bubbles: true }));
      };
      set("route", "turn-udp");
      set("twoWay", false);
      window.stand.startCall();
    });
    try {
      await page.waitForFunction(() => window.stand.call && window.stand.call.connected, null, { timeout: 15_000 });
    } catch {
      console.log(`the call did not connect, try ${attempt + 1}`);
      continue;
    }
    const net = await page.evaluate(() => fetch("/api/net").then((r) => r.json()));
    if (!net.counters.forwarded) {
      throw new Error("The call does not go through the shaper of this stand");
    }
    return;
  }
  throw new Error("The stand's call did not connect on the TURN udp route");
}

async function testThisStream(page) {
  await page.evaluate(() => window.stand.testThisStream());
  await page.waitForFunction(() => window.__vtt.state() === "live", null, { timeout: 10_000 });
}

const waitForDrop = (page, ended, timeout) => page.waitForFunction(
  (wantEnded) => window.__vtt.problems().some((p) => p.type === "bandwidth_drop" && (p.tEnd !== null) === wantEnded),
  ended,
  { timeout, polling: 500 },
);

// The pointer away from the panel: a hovered button would show its tooltip on the screenshot.
const park = (page) => page.mouse.move(100, 300);

async function shoot(page, name) {
  const file = path.join(shotsDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(path.relative(root, file));
}

async function startStand() {
  const stand = spawn(process.execPath, [path.join(root, "stand", "server.mjs")], {
    env: { ...process.env, ...STAND_ENV },
    stdio: "ignore",
  });
  const until = Date.now() + 10_000;
  while (Date.now() < until) {
    const turn = await fetch(new URL("api/turn", STAND_URL)).then((r) => r.json()).catch(() => null);
    if (turn) {
      if (!turn.up) {
        stand.kill();
        throw new Error("TURN is not running: npm run stand:turn");
      }
      return stand;
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  stand.kill();
  throw new Error(`The stand did not start on ${STAND_URL}`);
}

async function screenshots(context) {
  const page = context.pages()[0] ?? (await context.newPage());
  const errors = [];
  page.on("pageerror", (error) => errors.push(`${error.message} ${error.stack ?? ""}`));
  page.on("console", (message) => message.type() === "error" && errors.push(`${message.text()} ${message.location()?.url ?? ""}`));
  await page.goto(STAND_URL);
  await page.waitForFunction(() => window.__vtt && window.stand, null, { timeout: 15_000 });
  // The page has taken the shaper ports of this stand from /api/turn.
  await page.waitForFunction(() => document.getElementById("turnBadge").textContent === "TURN running");
  await dressAsCall(page);
  const panelButton = (label) => page.locator(`#vttFrameContainer [aria-label="${label}"]`).first();

  console.log("run 1: a clean session for Previous run");
  await startCall(page);
  await testThisStream(page);
  await page.waitForTimeout(PREVIOUS_RUN_MS);
  // Close stops the session and keeps its summary for the next run on this site.
  await panelButton("Close").click();
  await park(page);
  await page.waitForFunction(() => window.__vtt.state() === "stopped");
  await page.evaluate(() => window.stand.stopCall());

  console.log("run 2: Throttle 300 kbit 10 s → Bandwidth drop");
  await startCall(page);
  await testThisStream(page);
  const frame = await (await page.waitForSelector("#vttFrame")).contentFrame();
  await page.waitForTimeout(BEFORE_DROP_MS - 10_000);
  await frame.getByRole("button", { name: "Mark", exact: true }).click();
  await page.waitForTimeout(10_000);
  await page.evaluate(() => window.stand.applyNetPreset("throttle300"));
  await waitForDrop(page, false, 20_000);
  // The status row names the worst problem going on: while the throttle lasts it is Audio stutter, then the drop.
  const named = await frame.waitForFunction(
    () => document.querySelector("[data-status]")?.textContent.startsWith("Bandwidth drop · now"),
    null,
    { timeout: 45_000, polling: 250 },
  ).then(() => true, () => false);
  if (!named) {
    console.log("the status row did not name Bandwidth drop");
  }
  await park(page);
  await page.waitForTimeout(1_500);
  await shoot(page, "1-compact");

  await waitForDrop(page, true, 120_000);
  await page.waitForTimeout(12_000);
  await panelButton("Open timeline").click();
  await frame.waitForSelector("[data-mode='expanded'] [data-timeline]");
  await park(page);
  await page.waitForTimeout(1_500);
  await shoot(page, "2-timeline");

  await frame.locator("[data-problems-list] [data-problem-id]", { hasText: "Bandwidth drop" }).first().click();
  await frame.waitForSelector("[data-problem-overlay] [data-problem-card]");
  await page.waitForTimeout(800);
  await shoot(page, "3-problem-card");

  await frame.getByRole("tab", { name: "Report" }).click();
  await frame.waitForSelector("[data-report] [data-previous-run]");
  await park(page);
  await page.waitForTimeout(1_500);
  await shoot(page, "4-report");

  await page.evaluate(async () => {
    await fetch("/api/net/clear", { method: "POST" });
    window.stand.stopCall();
  });
  const fromExtension = errors.filter((e) => e.includes("chrome-extension://"));
  console.log(fromExtension.length ? `extension errors:\n${fromExtension.join("\n")}` : "no extension errors");
}

async function main() {
  if (!fs.existsSync(path.join(buildDir, "manifest.json"))) {
    throw new Error("No build/: npm run build");
  }
  fs.mkdirSync(shotsDir, { recursive: true });
  packageZip();
  if (process.argv.includes("--zip")) {
    return;
  }
  const { chromium } = createRequire(path.join(root, "e2e", "package.json"))("@playwright/test");
  const stand = await startStand();
  // A fresh profile out of the project: its storage must not have a previous run of the stand yet.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "streamtest-store-"));
  try {
    const context = await chromium.launchPersistentContext(profile, {
      channel: "chromium",
      headless: !process.env.HEADED,
      viewport: SCREEN,
      deviceScaleFactor: 1,
      args: [
        `--disable-extensions-except=${buildDir}`,
        `--load-extension=${buildDir}`,
        "--autoplay-policy=no-user-gesture-required",
      ],
    });
    try {
      await promoTile(context);
      await screenshots(context);
    } finally {
      await context.close();
    }
  } finally {
    stand.kill();
    fs.rmSync(profile, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
