// The stand driven from a test: its call and scenario buttons, the StreamTest session on it and what the extension
// reports through window.__vtt (state, samples, events, problems).
import { STAND_URL } from "./paths.js";

// A TURN udp call now and then does not connect (ICE checking → failed, plan §6): the start is repeated.
const START_TRIES = 3;
const CONNECT_TIMEOUT_MS = 15_000;

// The stand page of a test; the errors of its console are collected from the start.
export class Stand {
  constructor(context, page) {
    this.context = context;
    this.page = page;
    this.messages = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        this.messages.push({ kind: "console", text: message.text(), url: message.location()?.url ?? "" });
      }
    });
    page.on("pageerror", (error) => this.messages.push({ kind: "pageerror", text: error.message, url: error.stack ?? "" }));
    // Nothing is saved: an export is checked by its name, the file itself is not needed.
    page.on("download", (download) => download.cancel().catch(() => {}));
  }

  // Opens the stand in the browser's first tab, once both the extension's window.__vtt and window.stand are there.
  static async open(context) {
    const page = context.pages()[0] ?? (await context.newPage());
    const stand = new Stand(context, page);
    await page.goto(STAND_URL);
    await page.waitForFunction(() => window.__vtt && window.stand, null, { timeout: 15_000 });
    return stand;
  }

  // Errors of the page's console and uncaught exceptions: the extension's (their source is chrome-extension://)
  // and the stand's.
  get errors() {
    const fromExtension = (e) => /chrome-extension:\/\//.test(`${e.url} ${e.text}`);
    return {
      all: () => [...this.messages],
      extension: () => this.messages.filter(fromExtension),
      stand: () => this.messages.filter((e) => !fromExtension(e)),
    };
  }

  // Whether the stand's coturn answers: start() picks the route by it, and network tests are skipped without it.
  async turnUp() {
    return this.page.evaluate(() => fetch("/api/turn").then((r) => r.json()).then((turn) => turn.up).catch(() => false));
  }

  // Starts the stand's call; the route is TURN udp when TURN runs, else Direct.
  async start({
    route, twoWay = true, preset = "normal", codec = "VP8", resolution = "720", fps = "30", autoStart = false,
  } = {}) {
    const chosen = route ?? ((await this.turnUp()) ? "turn-udp" : "direct");
    if (chosen === "direct") {
      await this.allowDirect();
    }
    for (let attempt = 1; attempt <= START_TRIES; attempt++) {
      await this.page.evaluate((settings) => {
        if (window.stand.call) {
          window.stand.stopCall();
        }
        Object.entries(settings).forEach(([id, value]) => {
          const control = document.getElementById(id);
          if (control.type === "checkbox") {
            control.checked = value;
          } else {
            control.value = value;
          }
          control.dispatchEvent(new Event("change", { bubbles: true }));
        });
        window.stand.startCall();
      }, {
        route: chosen, twoWay, preset, codec, resolution, fps, autoStart,
      });
      try {
        await this.page.waitForFunction(() => window.stand.call && window.stand.call.connected, null, { timeout: CONNECT_TIMEOUT_MS });
        return chosen;
      } catch {
        // Tried again below.
      }
    }
    throw new Error(`The stand's call did not connect on the ${chosen} route in ${START_TRIES} tries`);
  }

  // Direct needs the host candidates of the LAN: Chrome gathers them only when the page may use the camera (plan §6).
  async allowDirect() {
    await this.context.grantPermissions(["camera", "microphone"], { origin: new URL(STAND_URL).origin });
    await this.page.evaluate(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      stream.getTracks().forEach((track) => track.stop());
    });
  }

  // The stand's Test this stream: a session on the receiver video, as the context menu item starts it.
  async testThisStream() {
    await this.page.evaluate(() => window.stand.testThisStream());
    await this.page.waitForFunction(() => window.__vtt.state() === "live", null, { timeout: 10_000 });
  }

  // What the extension reports of its latest session, read from window.__vtt of the page.
  state() {
    return this.page.evaluate(() => window.__vtt.state());
  }

  sample() {
    return this.page.evaluate(() => window.__vtt.sample());
  }

  events() {
    return this.page.evaluate(() => window.__vtt.events());
  }

  problems() {
    return this.page.evaluate(() => window.__vtt.problems());
  }

  streams() {
    return this.page.evaluate(() => window.__vtt.streams());
  }

  // The latest sample once it fits `ok`.
  async waitForSample(ok = () => true, timeout = 15_000) {
    const until = Date.now() + timeout;
    for (;;) {
      const sample = await this.sample();
      if (sample && ok(sample)) {
        return sample;
      }
      if (Date.now() > until) {
        throw new Error(`No fitting sample in ${timeout} ms; the last: ${JSON.stringify(sample)}`);
      }
      await this.page.waitForTimeout(250);
    }
  }

  // Seconds of the session now (the latest sample's t).
  async now() {
    return (await this.sample())?.t ?? 0;
  }

  // Waits for a problem of the type (PRD §12.3) that fits `ok`; returns it. `timeout` — ms from now.
  async waitForProblem(type, { timeout = 10_000, ok = () => true } = {}) {
    const until = Date.now() + timeout;
    for (;;) {
      const problem = ((await this.problems()) ?? []).find((p) => p.type === type && ok(p));
      if (problem) {
        return problem;
      }
      if (Date.now() > until) {
        const seen = ((await this.problems()) ?? []).map((p) => `${p.type} ${p.oneLine}`);
        throw new Error(`No ${type} problem in ${timeout} ms; problems: ${JSON.stringify(seen)}`);
      }
      await this.page.waitForTimeout(200);
    }
  }

  async waitForState(state, timeout = 10_000) {
    await this.page.waitForFunction((expected) => window.__vtt.state() === expected, state, { timeout });
  }

  // A scenario button of the stand (plan §3), by its id: jankBtn, freezeBtn, pauseBtn, closeBtn, secondBtn, cpuBtn …
  async press(id) {
    await this.page.click(`#${id}`);
  }

  // A network preset of the stand (Clean, Loss 5 %, Throttle 300 kbit 10 s, Blackout 3 / 8 / 40 s …) by its name in
  // stand.js: loss5, loss20, jitter, throttle300, blackout3, blackout8, blackout40, clean. Only on the TURN udp route.
  async net(preset, target = "call") {
    await this.page.evaluate(([name, where]) => window.stand.applyNetPreset(name, where), [preset, target]);
  }

  // Headless Chromium does not hide a tab behind another one: `document.hidden` and visibilitychange are emulated.
  async setTabHidden(hidden) {
    await this.page.evaluate((value) => {
      Object.defineProperty(document, "hidden", { configurable: true, get: () => value });
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => (value ? "hidden" : "visible") });
      document.dispatchEvent(new Event("visibilitychange"));
    }, hidden);
  }

  // The panel's iframe.
  async panel() {
    await this.page.waitForFunction(() => document.getElementById("vttFrame"), null, { timeout: 10_000 });
    const handle = await this.page.$("#vttFrame");
    return handle.contentFrame();
  }

  // The network is cleaned for the next test, then the calls are closed while the browser still runs: it releases
  // its TURN allocations, which otherwise hold relay ports of the stand's coturn for 10 min.
  async close() {
    await this.page.evaluate(async () => {
      await fetch("/api/net/clear", { method: "POST" });
      window.stand.stopCall();
    }).catch(() => {});
    await this.page.waitForTimeout(500).catch(() => {});
  }
}
