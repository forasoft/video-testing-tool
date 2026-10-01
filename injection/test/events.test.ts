import { afterEach, describe, expect, it, vi } from "vitest";
import { SampleValues } from "shared/constants/sampleFields";
import { EVENT_LIMIT, EventLog, firstFrameLabel, SampleEvents, trackVisibility } from "src/session/events";
import { emptySample } from "src/session/metrics";

const RELAY = 3;

const sample = (t: number, values: Partial<SampleValues> = {}): SampleValues => ({ ...emptySample(), t, ...values });

// Heights (null — a second without data) → the log after feeding them one per second.
const feedHeights = (heights: (number | null)[]) => {
  const log = new EventLog();
  const events = new SampleEvents(log);
  heights.forEach((h, t) => events.onSample(sample(t, { v_h: h })));
  return log.events;
};

describe("EventLog", () => {
  it("numbers events through the session and sends each one", () => {
    const send = vi.fn();
    const log = new EventLog(send);

    log.add(1.2, "first_frame", firstFrameLabel(1.2), "green");
    log.add(5, "tab_hidden", "Tab hidden", "gray");
    log.mark(7.4);
    log.mark(9);

    expect(log.events.map((e) => [e.n, e.label])).toEqual([
      [1, "First frame 1.20 s"],
      [2, "Tab hidden"],
      [3, "Mark 1"],
      [4, "Mark 2"],
    ]);
    expect(send).toHaveBeenCalledTimes(4);
    expect(send).toHaveBeenLastCalledWith({ n: 4, t: 9, kind: "mark", label: "Mark 2", tone: "blue" });
  });

  it("keeps 2000 events, dropping the oldest but never a mark", () => {
    const log = new EventLog();
    log.mark(0);
    for (let i = 1; i <= EVENT_LIMIT + 5; i++) {
      log.add(i, "tab_visible", "Tab visible", "gray");
    }

    expect(log.events).toHaveLength(EVENT_LIMIT);
    expect(log.events[0]).toMatchObject({ n: 1, kind: "mark" });
    // Tab events 1…6 (numbers 2…7) were dropped; numbering goes on.
    expect(log.events[1].n).toBe(8);
    expect(log.events[log.events.length - 1].n).toBe(EVENT_LIMIT + 6);
  });

  it("finds events of a kind in a time range", () => {
    const log = new EventLog();
    log.add(3, "layer_change", "720p → 360p", "yellow", { from: 720, to: 360 });
    log.add(8, "layer_change", "360p → 720p", "green", { from: 360, to: 720 });
    log.add(9, "tab_hidden", "Tab hidden", "gray");

    expect(log.between("layer_change", 3, 8).map((e) => e.to)).toEqual([360, 720]);
    expect(log.between("layer_change", 4, 20).map((e) => e.to)).toEqual([720]);
  });
});

describe("SampleEvents", () => {
  it("reports a layer change once the new height has held for 1 s, at the time it appeared", () => {
    const events = feedHeights([720, 720, 720, 360, 360, 360, 720, 720]);

    expect(events.map(({ t, label, tone, from, to }) => ({ t, label, tone, from, to }))).toEqual([
      { t: 3, label: "720p → 360p", tone: "yellow", from: 720, to: 360 },
      { t: 6, label: "360p → 720p", tone: "green", from: 360, to: 720 },
    ]);
  });

  it("ignores a height that does not hold for 1 s and seconds without data", () => {
    expect(feedHeights([720, 720, 360, 720, 720, 540, 720])).toEqual([]);
    expect(feedHeights([720, 720, null, 720, 360, null, 360])).toEqual([
      expect.objectContaining({ t: 4, label: "720p → 360p" }),
    ]);
  });

  it("does not report the starting layer, even when it settles after a first wobble", () => {
    expect(feedHeights([null, 180, 720, 720, 720])).toEqual([]);
  });

  it("reports a path change when pair_changes grows after the first selected pair", () => {
    const log = new EventLog();
    const events = new SampleEvents(log);
    // No pair yet → first pair (the browser counts it as change 1) → ICE restart without a pair → new pair.
    events.onSample(sample(0, { pair_type: null, pair_changes: 0 }));
    events.onSample(sample(1, { pair_type: 0, pair_changes: 1 }));
    events.onSample(sample(2, { pair_type: 0, pair_changes: 1 }));
    events.onSample(sample(3, { pair_type: null, pair_changes: null }));
    events.onSample(sample(4, { pair_type: RELAY, pair_changes: 2 }));
    events.onSample(sample(5, { pair_type: RELAY, pair_changes: 2 }));

    expect(log.events.map(({ t, kind, label, tone }) => ({ t, kind, label, tone }))).toEqual([
      { t: 4, kind: "path_change", label: "Path → relay", tone: "yellow" },
    ]);
  });
});

describe("trackVisibility", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adds Tab hidden / Tab visible on visibilitychange until stopped", () => {
    const listeners: (() => void)[] = [];
    const doc = {
      hidden: false,
      addEventListener: (_: string, fn: () => void) => listeners.push(fn),
      removeEventListener: vi.fn(),
    };
    vi.stubGlobal("document", doc);
    const log = new EventLog();
    let now = 10;
    const stop = trackVisibility(log, () => now);

    doc.hidden = true;
    listeners.forEach((fn) => fn());
    now = 20.5;
    doc.hidden = false;
    listeners.forEach((fn) => fn());
    stop();

    expect(log.events.map(({ t, kind, label }) => ({ t, kind, label }))).toEqual([
      { t: 10, kind: "tab_hidden", label: "Tab hidden" },
      { t: 20.5, kind: "tab_visible", label: "Tab visible" },
    ]);
    expect(doc.removeEventListener).toHaveBeenCalledWith("visibilitychange", listeners[0]);
  });
});
