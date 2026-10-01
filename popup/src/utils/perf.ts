// Renders of the panel and redraws of its charts (PRD §18: ≤ 1 render a second + 4 of Frame rate, a redraw ≤ 8 ms),
// for __vtt.debug.perf() on the page: it asks with VTT_GET_PERF, the panel answers VTT_PERF.
import { useLayoutEffect } from "react";
import { GetPerfMessage, MESSAGES, PanelPerfMessage } from "../../../shared/protocol";
import { postToWindow } from "./postToWindow";

// The views whose renders are counted: the tiles of Compact and Mini, the Timeline and the Report tabs.
export type PerfView = "tiles" | "timeline" | "report";

// Renders kept: over a minute of them.
const KEPT_MS = 60_000;

interface Render {
  at: number;
  view: PerfView | "fps";
  // How long the render took until the DOM was updated, ms; the Frame rate renders are only counted.
  ms?: number;
}

let renders: Render[] = [];
// The view drawn last.
let shown: PerfView | null = null;

const note = (render: Render) => {
  renders.push(render);
  if (renders[0].at < render.at - KEPT_MS) {
    renders = renders.filter(({ at }) => at >= render.at - KEPT_MS);
  }
};

// A render of a view that took `ms` until the DOM was updated.
export const noteViewRender = (view: PerfView, ms: number, at = performance.now()): void => {
  shown = view;
  note({ at, view, ms });
};

// Counts every render of a view and measures its redraw: from the start of the view's render to the DOM updated,
// the view's charts included (a `StreamTest {view}` measure in the Performance panel of DevTools).
export const useViewPerf = (view: PerfView): void => {
  const start = performance.now();
  useLayoutEffect(() => {
    const name = `StreamTest ${view}`;
    const measure = performance.measure(name, { start, end: performance.now() });
    performance.clearMeasures(name);
    noteViewRender(view, measure.duration, measure.startTime + measure.duration);
  });
};

// A render caused by VTT_FPS: only the Frame rate values are drawn again.
export const noteFpsRender = (at = performance.now()): void => note({ at, view: "fps" });

// Mean, p95 and max of the redraws, ms.
const timing = (values: number[]): PanelPerfMessage["redrawMs"] => {
  if (!values.length) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = 0.95 * (sorted.length - 1);
  const low = Math.floor(rank);
  const round = (ms: number) => Math.round(ms * 1000) / 1000;
  return {
    mean: round(sorted.reduce((sum, v) => sum + v, 0) / sorted.length),
    p95: round(sorted[low] + (sorted[Math.ceil(rank)] - sorted[low]) * (rank - low)),
    max: round(sorted[sorted.length - 1]),
  };
};

// The renders of the shown view and of Frame rate in the last windowS seconds; the start screen has no view.
export const panelPerf = (windowS: number, mainScreen: boolean, now = performance.now()): PanelPerfMessage => {
  const recent = renders.filter(({ at }) => at >= now - windowS * 1000);
  const view = mainScreen ? null : shown;
  const own = recent.filter((r) => r.view === view);
  const rate = (count: number) => Math.round((count / windowS) * 100) / 100;
  return {
    view,
    rendersPerS: rate(own.length),
    fpsRendersPerS: rate(recent.filter((r) => r.view === "fps").length),
    redrawMs: timing(own.map((r) => r.ms as number)),
  };
};

// Answers VTT_GET_PERF of the page; `mainScreen` — whether the start screen is shown.
export const answerPerf = (e: MessageEvent, mainScreen: boolean): void => {
  if (e.data?.id === MESSAGES.VTT_GET_PERF) {
    const { windowS } = (e.data.data ?? {}) as Partial<GetPerfMessage>;
    postToWindow(MESSAGES.VTT_PERF, panelPerf(typeof windowS === "number" && windowS > 0 ? windowS : 10, mainScreen));
  }
};
