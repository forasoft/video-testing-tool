// The time window of the timeline (PRD §11.1, §11.3): the last 2 minutes or the whole session,
// following the time while Live, or where the tester dragged it.
import { BUFFER_SECONDS } from "../../../../../shared/constants/sampleFields";
import { GetHistoryMessage } from "../../../../../shared/protocol";
import { lastWindow, TimeWindow } from "./scale";

// `Last 2 min` or `Whole session` of the window switch.
export type WindowRange = "last2" | "whole";

// The 2-minute window, s.
const LAST_SPAN_S = 120;
// Time labels every 20 s in the 2-minute window (PRD §11.2).
const LAST_TICK_S = 20;
// Whole session: the first of these steps that gives at most 12 labels, so that there are 6–12.
const WHOLE_TICKS_S = [30, 60, 120, 300, 600];
const MAX_TICKS = 12;
const MIN_TICKS = 6;
// Whole session: at most this many points, about one per pixel of the plot.
const WHOLE_BUCKETS = 720;
// A dragged window asks for this much more on each side, so that a short drag needs no new answer.
const MARGIN_S = 60;

// The whole session is at most as long as the history the injection keeps.
export const spanOf = (range: WindowRange): number => (range === "whole" ? BUFFER_SECONDS : LAST_SPAN_S);

// The right edge of the window: now while Live, else where the tester left it.
export const edgeOf = (live: boolean, end: number | null, now: number): number => (
  live || end === null ? now : Math.min(end, now)
);

// The window of the range that ends at `edge`; while the session is shorter than the range, it starts at 0.
export const windowOf = (range: WindowRange, edge: number): TimeWindow => lastWindow(edge, spanOf(range));

// The right edge moved by dt seconds (later is positive): not before the kept history allows a
// whole window and not after now. A window as long as the session does not move.
export const panEdge = (edge: number, dt: number, now: number, span: number): number => {
  const first = Math.max(0, now - BUFFER_SECONDS);
  const min = Math.min(now, first + span);
  return Math.min(now, Math.max(min, edge + dt));
};

// The right edge that puts the middle of [from, to] at `share` of the window from its left (the
// middle of the part the open card leaves visible), as far as the window can move; the whole
// session is shown as it is, stopped at now.
export const centerEdge = (from: number, to: number, range: WindowRange, now: number, share = 0.5): number => {
  if (range === "whole") {
    return now;
  }
  const span = spanOf(range);
  return panEdge((from + to) / 2 + span * (1 - share), 0, now, span);
};

// The problem card covers this much of the plots at their right (PRD §12.2: 400 px, 8 px from the
// card's edge, which is 16 px from the plots); a problem is centered in the rest, but not closer
// to the left edge than 15 % of the window.
const CARD_COVER_PX = 392;
const MIN_SHARE = 0.15;

// Where a problem goes with its card open, as a share of the window from its left: the middle of what the card leaves
// visible; the window's middle until the plots are measured.
export const visibleCenter = (plotWidth: number): number => (
  plotWidth > 0 ? Math.min(0.5, Math.max(MIN_SHARE, (plotWidth - CARD_COVER_PX) / 2 / plotWidth)) : 0.5
);

// How many multiples of `step` fall inside the window.
const tickCount = ({ from, to }: TimeWindow, step: number): number =>
  Math.floor(to / step + 1e-9) - Math.ceil(from / step - 1e-9) + 1;

// Step of the time labels, s. A whole session too short for 6 labels at 30 s is labeled like
// the 2-minute window, which it then equals.
export const tickStep = (range: WindowRange, window: TimeWindow): number => {
  if (range === "last2") {
    return LAST_TICK_S;
  }
  const step = WHOLE_TICKS_S.find((s) => tickCount(window, s) <= MAX_TICKS) ?? WHOLE_TICKS_S[WHOLE_TICKS_S.length - 1];
  return tickCount(window, step) < MIN_TICKS ? LAST_TICK_S : step;
};

// What to ask the injection for (VTT_GET_HISTORY). The whole session — always, in buckets; a
// dragged 2-minute window — the samples of it and around it when the samples the popup keeps
// (from `kept` on) do not cover it; null — nothing to ask.
export const historyRequest = (
  range: WindowRange,
  live: boolean,
  window: TimeWindow,
  kept: number | null,
  now: number
): GetHistoryMessage | null => {
  if (range === "whole") {
    return { from: window.from, to: window.to, buckets: WHOLE_BUCKETS };
  }
  if (live || (kept !== null && window.from >= kept)) {
    return null;
  }
  return { from: Math.max(0, window.from - MARGIN_S), to: Math.min(now, window.to + MARGIN_S) };
};

// Whether an asked range gives the part of a dragged window before the kept samples.
export const covers = (asked: GetHistoryMessage | null, window: TimeWindow, kept: number | null): boolean => (
  asked !== null && asked.from <= window.from && asked.to >= Math.min(window.to, kept ?? window.to)
);
