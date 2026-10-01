// The load StreamTest puts on the page and its panel (PRD §18), for __vtt.debug.perf(): getStats() calls
// per connection, the time of the rVFC callback and of a sample's processing on the page, and the panel's
// renders and chart redraws, which the panel counts itself (VTT_GET_PERF → VTT_PERF). The counting costs
// two performance.now() and two array writes per frame.
import { MESSAGES, PanelPerfMessage } from "shared/protocol";
import { postToPopup } from "../utils/postToPopup";

// PRD §18.
export const PERF_LIMITS = {
  getStatsPerS: 1,
  otherGetStatsPer5S: 1,
  rvfcMs: 0.1,
  rendersPerS: 1,
  fpsRendersPerS: 4,
  redrawMs: 8,
  memoryMB: 8,
};

// The window of perf(), s.
export const PERF_WINDOW_S = 10;
// The panel answers VTT_GET_PERF within this, or the report has no panel part.
export const PANEL_TIMEOUT_MS = 1000;
// Measurements kept: over a minute of frames at 60 fps.
const KEPT = 4096;

// The last KEPT measurements with their time (performance.now()), in a ring: nothing is allocated per frame.
export class TimedValues {
  private readonly times = new Float64Array(KEPT);
  private readonly values = new Float64Array(KEPT);
  private next = 0;
  private count = 0;

  // Overwrites the oldest measurement once KEPT are stored.
  add(value: number, now = performance.now()): void {
    this.times[this.next] = now;
    this.values[this.next] = value;
    this.next = (this.next + 1) % KEPT;
    this.count = Math.min(this.count + 1, KEPT);
  }

  // Values measured since `from` (performance.now()), oldest first.
  since(from: number): number[] {
    const out: number[] = [];
    for (let i = 0; i < this.count; i++) {
      const slot = (this.next - this.count + i + KEPT) % KEPT;
      if (this.times[slot] >= from) {
        out.push(this.values[slot]);
      }
    }
    return out;
  }
}

const round3 = (ms: number) => Math.round(ms * 1000) / 1000;

// Mean, p95 and max of a set of timings, ms.
export interface Timing {
  mean: number;
  p95: number;
  max: number;
}

// Mean, p95 and max of timings, ms; null without any. A page's performance.now() is coarsened to 0.1 ms, so a
// callback shorter than that is told only by the mean of many.
export const timing = (values: number[]): Timing | null => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = 0.95 * (sorted.length - 1);
  const low = Math.floor(rank);
  const p95 = sorted[low] + (sorted[Math.ceil(rank)] - sorted[low]) * (rank - low);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  return { mean: round3(mean), p95: round3(p95), max: round3(sorted[sorted.length - 1]) };
};

const ids = new WeakMap<RTCPeerConnection, number>();
let lastId = 0;

// A number per connection: the calls are kept by it, so that a closed connection can be collected.
export const connectionId = (peer: RTCPeerConnection): number => {
  let id = ids.get(peer);
  if (id === undefined) {
    lastId += 1;
    id = lastId;
    ids.set(peer, id);
  }
  return id;
};

// The page's measurements for __vtt.debug.perf(), each kept with its time.
export const perf = {
  // The connection's number of every getStats() call.
  statsCalls: new TimedValues(),
  // ms of each rVFC callback and of each sample's processing on the page.
  frameMs: new TimedValues(),
  sampleMs: new TimedValues(),
};

// Every getStats() of StreamTest goes through here, so that the calls can be counted.
export const getStats = (peer: RTCPeerConnection): Promise<RTCStatsReport> => {
  perf.statsCalls.add(connectionId(peer));
  return peer.getStats();
};

// getStats() calls in the last windowS seconds: of the selected connection per second, of the busiest other
// one per 5 s.
export const statsRates = (selected: RTCPeerConnection | null, windowS: number, now = performance.now()) => {
  const calls = perf.statsCalls.since(now - windowS * 1000);
  const own = selected ? connectionId(selected) : null;
  const others = new Map<number, number>();
  calls.filter((id) => id !== own).forEach((id) => others.set(id, (others.get(id) ?? 0) + 1));
  const round = (value: number) => Math.round(value * 100) / 100;
  return {
    getStatsPerS: own === null ? null : round(calls.filter((id) => id === own).length / windowS),
    otherGetStatsPer5S: round((Math.max(0, ...others.values()) * 5) / windowS),
  };
};

// The askPanel() calls that wait for VTT_PERF: the panel's answer resolves all of them.
const waiting = new Set<(message: PanelPerfMessage | null) => void>();

// The panel's renders and redraws over the window; null when it does not answer in time (no panel on the page).
export const askPanel = (windowS: number): Promise<PanelPerfMessage | null> => new Promise((resolve) => {
  const answer = (message: PanelPerfMessage | null) => {
    clearTimeout(timer);
    waiting.delete(answer);
    resolve(message);
  };
  const timer = setTimeout(() => {
    answer(null);
  }, PANEL_TIMEOUT_MS);
  waiting.add(answer);
  postToPopup(MESSAGES.VTT_GET_PERF, { windowS });
});

// VTT_PERF of the panel.
export const panelAnswered = (message: PanelPerfMessage): void => {
  waiting.forEach((answer) => {
    answer(message);
  });
};
