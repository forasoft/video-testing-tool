import { describe, expect, it } from "vitest";
import { SampleValues } from "shared/constants/sampleFields";
import { HistoryMessage } from "shared/protocol";
import { emptySample } from "src/session/metrics";
import {
  centerEdge, covers, edgeOf, historyRequest, panEdge, tickStep, visibleCenter, windowOf
} from "../../popup/src/components/expanded/timeline/window";
import { chartRows, historyRows, visibleRows } from "../../popup/src/components/expanded/timeline/rows";

// Popup's timeline window (PRD §11.1, §11.3): Last 2 min / Whole session, Live and dragging.
describe("timeline window", () => {
  it("follows now while Live and stays where it was left otherwise", () => {
    expect(edgeOf(true, 200, 300)).toBe(300);
    expect(edgeOf(false, 200, 300)).toBe(200);
    expect(edgeOf(false, null, 300)).toBe(300);
    // Never after now.
    expect(edgeOf(false, 350, 300)).toBe(300);
  });

  it("is 2 minutes or the whole kept history up to the edge", () => {
    expect(windowOf("last2", 300)).toEqual({ from: 180, to: 300 });
    expect(windowOf("last2", 45)).toEqual({ from: 0, to: 45 });
    expect(windowOf("whole", 300)).toEqual({ from: 0, to: 300 });
    // After an hour only the last 60 minutes are kept (PRD §6.4).
    expect(windowOf("whole", 4000)).toEqual({ from: 400, to: 4000 });
  });

  it("drags inside the kept history and not after now", () => {
    // Dragged right: earlier; left: later.
    expect(panEdge(300, -48, 300, 120)).toBe(252);
    expect(panEdge(252, 30, 300, 120)).toBe(282);
    expect(panEdge(252, 100, 300, 120)).toBe(300);
    // The first 2 minutes are the earliest window.
    expect(panEdge(300, -250, 300, 120)).toBe(120);
    // A session shorter than the window, or the whole session: nothing to move.
    expect(panEdge(80, -30, 80, 120)).toBe(80);
    expect(panEdge(300, -60, 300, 3600)).toBe(300);
    // After an hour the oldest kept second is now − 3600.
    expect(panEdge(4000, -3600, 4000, 120)).toBe(520);
  });

  it("centers a problem in the part of the window the open card leaves visible", () => {
    // 742 px of plots, the card covers 392 px at the right: the middle of the rest is at 23.6 %.
    const share = visibleCenter(742);
    expect(share).toBeCloseTo(175 / 742, 9);
    // A problem at 59…90 s of a 200-s session: its middle (74.5 s) 23.6 % into the window.
    const edge = centerEdge(59, 90, "last2", 200, share);
    expect((74.5 - (edge - 120)) / 120).toBeCloseTo(share, 9);
    // Near now the window stops at now: the problem is further right.
    expect(centerEdge(59, 90, "last2", 157, share)).toBe(157);
    // In the middle of the window by default; the window cannot go past now or before 0:00.
    expect(centerEdge(59, 90, "last2", 157)).toBe(134.5);
    expect(centerEdge(140, 150, "last2", 157)).toBe(157);
    expect(centerEdge(10, 20, "last2", 157)).toBe(120);
    // The whole session stays as it is, stopped at now.
    expect(centerEdge(59, 90, "whole", 157)).toBe(157);
    // A narrow panel keeps the problem off the left edge; without a width — the middle.
    expect(visibleCenter(450)).toBe(0.15);
    expect(visibleCenter(0)).toBe(0.5);
  });

  it("labels 2 minutes every 20 s and the whole session with 6–12 labels", () => {
    expect(tickStep("last2", { from: 180, to: 300 })).toBe(20);
    // 5 min: every 30 s — 11 labels.
    expect(tickStep("whole", { from: 0, to: 300 })).toBe(30);
    // 7 min: 30 s would give 15 labels, 1 min gives 8.
    expect(tickStep("whole", { from: 0, to: 420 })).toBe(60);
    expect(tickStep("whole", { from: 0, to: 1500 })).toBe(300);
    // An hour: 5 min would give 13 labels from 0:00, 12 from 6:40 on.
    expect(tickStep("whole", { from: 0, to: 3600 })).toBe(600);
    expect(tickStep("whole", { from: 400, to: 4000 })).toBe(300);
    // Shorter than 2:30: as the 2-minute window, which it equals.
    expect(tickStep("whole", { from: 0, to: 100 })).toBe(20);
  });

  it("asks for the whole session in buckets and for a dragged window outside the kept samples", () => {
    expect(historyRequest("whole", true, { from: 0, to: 300 }, 175, 300)).toEqual({ from: 0, to: 300, buckets: 720 });
    // Live 2 minutes: the popup keeps them.
    expect(historyRequest("last2", true, { from: 180, to: 300 }, 175, 300)).toBeNull();
    // Dragged a little: still inside the kept samples.
    expect(historyRequest("last2", false, { from: 176, to: 296 }, 175, 300)).toBeNull();
    // Dragged further: the samples of the window with a minute around it, raw.
    expect(historyRequest("last2", false, { from: 100, to: 220 }, 175, 300)).toEqual({ from: 40, to: 280 });
    expect(historyRequest("last2", false, { from: 30, to: 150 }, 175, 180)).toEqual({ from: 0, to: 180 });
  });

  it("knows when what was asked covers a dragged window", () => {
    const asked = { from: 40, to: 280 };

    expect(covers(asked, { from: 100, to: 220 }, 175)).toBe(true);
    expect(covers(asked, { from: 30, to: 150 }, 175)).toBe(false);
    // Only the part before the kept samples has to be covered.
    expect(covers({ from: 40, to: 180 }, { from: 100, to: 220 }, 175)).toBe(true);
    expect(covers(null, { from: 100, to: 220 }, 175)).toBe(false);
  });
});

describe("timeline rows", () => {
  const sample = (t: number, values: Partial<SampleValues> = {}): SampleValues => ({ ...emptySample(), t, ...values });
  const history = (series: HistoryMessage["series"]): HistoryMessage => ({
    from: 0, to: 10, series, hiddenRanges: [], events: [], problems: [],
  });

  it("turns the history's series into samples", () => {
    const rows = historyRows(history({ t: [1, 2], v_bitrate: [100, null], d_video: [120, 130] }));

    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ t: 1, v_bitrate: 100, d_video: 120, v_loss: null });
    expect(rows[1]).toMatchObject({ t: 2, v_bitrate: null, d_video: 130 });
  });

  it("puts the kept samples after the history's last point", () => {
    const kept = [sample(4, { v_bitrate: 4 }), sample(5, { v_bitrate: 5 }), sample(6, { v_bitrate: 6 })];

    expect(chartRows(kept, null)).toBe(kept);
    expect(chartRows(kept, historyRows(history({ t: [2.5, 4.5], v_bitrate: [3, 4] }))).map((r) => [r.t, r.v_bitrate])).toEqual([
      [2.5, 3], [4.5, 4], [5, 5], [6, 6],
    ]);
  });

  it("shows the rows of the window and one on each side of it", () => {
    const rows = [0, 1, 2, 3, 4, 5, 6].map((t) => sample(t));

    expect(visibleRows(rows, { from: 2, to: 4 }).map((r) => r.t)).toEqual([1, 2, 3, 4, 5]);
    expect(visibleRows(rows, { from: 1.5, to: 3.5 }).map((r) => r.t)).toEqual([1, 2, 3, 4]);
    expect(visibleRows(rows, { from: 0, to: 10 }).map((r) => r.t)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(visibleRows(rows, { from: 7, to: 9 })).toEqual([]);
  });
});
