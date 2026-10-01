import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MESSAGES, PanelPerfMessage } from "shared/protocol";
import {
  askPanel, connectionId, getStats, PANEL_TIMEOUT_MS, panelAnswered, perf, statsRates, timing, TimedValues,
} from "src/session/perf";
import { postBatch, postToPopup } from "src/utils/postToPopup";
import {
  answerPerf, noteFpsRender, noteViewRender, panelPerf,
} from "../../popup/src/utils/perf";

// Load of the page and the panel for __vtt.debug.perf() (plan T5.4, PRD §18).
describe("perf counters of the page", () => {
  it("keep the latest measurements in a ring and give those since a time", () => {
    const values = new TimedValues();
    for (let i = 0; i < 5000; i++) {
      values.add(i, i * 10);
    }

    expect(values.since(49_970)).toEqual([4997, 4998, 4999]);
    // A minute of frames at 60 fps and more is kept; the oldest go.
    const kept = values.since(-Infinity);
    expect(kept.length).toBeGreaterThanOrEqual(3600);
    expect(kept[0]).toBe(5000 - kept.length);
  });

  it("tell the mean, p95 and max of timings", () => {
    expect(timing([])).toBeNull();
    expect(timing([0.1, 0, 0, 0.1, 0, 0, 0, 0, 0, 0.3])).toEqual({ mean: 0.05, p95: 0.21, max: 0.3 });
    expect(timing([4])).toEqual({ mean: 4, p95: 4, max: 4 });
  });

  it("count getStats() calls per connection: the selected one per second, the busiest other per 5 s", async () => {
    const report = {} as RTCStatsReport;
    const peer = (): RTCPeerConnection => ({ getStats: vi.fn(() => Promise.resolve(report)) }) as unknown as RTCPeerConnection;
    const [selected, other, third] = [peer(), peer(), peer()];
    const now = performance.now();
    for (let s = 0; s < 10; s++) {
      perf.statsCalls.add(connectionId(selected), now - 9500 + s * 1000);
    }
    perf.statsCalls.add(connectionId(other), now - 7000);
    perf.statsCalls.add(connectionId(other), now - 2000);
    perf.statsCalls.add(connectionId(third), now - 2000);
    // Older than the window: not counted.
    perf.statsCalls.add(connectionId(selected), now - 20_000);

    expect(await getStats(selected)).toBe(report);
    expect(selected.getStats).toHaveBeenCalledTimes(1);
    expect(statsRates(selected, 10, now + 1)).toEqual({ getStatsPerS: 1.1, otherGetStatsPer5S: 1 });
    expect(statsRates(null, 10, now + 1).getStatsPerS).toBeNull();
    expect(connectionId(selected)).not.toBe(connectionId(other));
  });
});

describe("the panel's answer", () => {
  const frame = { postMessage: vi.fn() };

  beforeEach(() => {
    vi.useFakeTimers();
    frame.postMessage.mockClear();
    vi.stubGlobal("window", { frames: { vttFrame: frame } });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("is asked for with VTT_GET_PERF and comes as VTT_PERF; no panel — null after a second", async () => {
    const answer: PanelPerfMessage = {
      view: "timeline", rendersPerS: 1, fpsRendersPerS: 4, redrawMs: { mean: 2, p95: 3, max: 3.5 },
    };
    const asked = askPanel(10);
    expect(frame.postMessage).toHaveBeenCalledWith({ id: MESSAGES.VTT_GET_PERF, data: { windowS: 10 } }, "*");
    panelAnswered(answer);
    expect(await asked).toBe(answer);

    const unanswered = askPanel(10);
    await vi.advanceTimersByTimeAsync(PANEL_TIMEOUT_MS);
    expect(await unanswered).toBeNull();
  });

  it("goes as one VTT_BATCH with the messages of a second, in order; a single message goes as it is", () => {
    postBatch(() => {
      postToPopup(MESSAGES.VTT_PROBLEM, { id: 1 });
      postBatch(() => postToPopup(MESSAGES.VTT_EVENT, { n: 2 }));
      postToPopup(MESSAGES.VTT_SAMPLE, { t: 3 });
    });
    postBatch(() => postToPopup(MESSAGES.VTT_SAMPLE, { t: 4 }));
    postBatch(() => undefined);

    expect(frame.postMessage.mock.calls.map(([message]) => message)).toEqual([
      {
        id: MESSAGES.VTT_BATCH,
        data: [
          { id: MESSAGES.VTT_PROBLEM, data: { id: 1 } },
          { id: MESSAGES.VTT_EVENT, data: { n: 2 } },
          { id: MESSAGES.VTT_SAMPLE, data: { t: 3 } },
        ],
      },
      { id: MESSAGES.VTT_SAMPLE, data: { t: 4 } },
    ]);
  });
});

describe("perf counters of the panel", () => {
  it("count the renders of the shown view and of Frame rate in the window, the redraw's mean, p95 and max", () => {
    const now = 100_000;
    for (let s = 0; s < 10; s++) {
      noteViewRender("timeline", 2 + (s % 3), now - 9500 + s * 1000);
      [0, 250, 500, 750].forEach((ms) => noteFpsRender(now - 9500 + s * 1000 + ms));
    }

    expect(panelPerf(10, false, now)).toEqual({
      view: "timeline", rendersPerS: 1, fpsRendersPerS: 4, redrawMs: { mean: 2.9, p95: 4, max: 4 },
    });
    // The start screen has no view.
    expect(panelPerf(10, true, now)).toMatchObject({ view: null, rendersPerS: 0, redrawMs: null });
  });

  it("answers VTT_GET_PERF of the page with VTT_PERF", () => {
    const parent = { postMessage: vi.fn() };
    vi.stubGlobal("window", { parent });

    answerPerf({ data: { id: MESSAGES.VTT_GET_PERF, data: { windowS: 5 } } } as MessageEvent, false);
    answerPerf({ data: { id: MESSAGES.VTT_SAMPLE, data: {} } } as MessageEvent, false);

    expect(parent.postMessage).toHaveBeenCalledTimes(1);
    expect(parent.postMessage.mock.calls[0][0]).toMatchObject({ id: MESSAGES.VTT_PERF, data: { view: "timeline" } });
    vi.unstubAllGlobals();
  });
});
