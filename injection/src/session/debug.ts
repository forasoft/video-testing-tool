// __vtt.debug (plan T5.4): the load of StreamTest against the limits of PRD §18, a session fast-forwarded to an
// hour, and the size of its export files.
import { sessionCsv } from "./export/csv";
import { jsonText, sessionJson } from "./export/json";
import {
  askPanel, perf, PERF_LIMITS, PERF_WINDOW_S, statsRates, timing, Timing,
} from "./perf";
import { getLastSession } from "./session";

const MB = 1024 * 1024;

const round = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

// The page's JS heap (Chrome's performance.memory): exact only with --enable-precise-memory-info, otherwise
// rounded and refreshed rarely.
const heapMB = (): number | null => {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? round(memory.usedJSHeapSize / MB, 1) : null;
};

export interface PerfReport {
  windowS: number;
  // The page: getStats() calls of the selected connection per second and of the busiest other one per 5 s; the
  // rVFC callback and a sample's processing, ms.
  page: {
    getStatsPerS: number | null;
    otherGetStatsPer5S: number;
    rvfcMs: Timing | null;
    sampleMs: Timing | null;
  };
  // The panel: the view it shows, its renders and those of Frame rate per second, its redraw, ms; null when it
  // did not answer.
  panel: {
    view: string | null;
    rendersPerS: number;
    fpsRendersPerS: number;
    redrawMs: Timing | null;
  } | null;
  // The latest session's data (the sample buffer and an estimate of its objects, session.ts) and the page's
  // whole JS heap, MB.
  memory: { sessionMB: number | null; heapMB: number | null };
  // What goes beyond PRD §18, e.g. `redrawMs p95 9.4 > 8`; empty when all is within.
  exceeded: string[];
}

// __vtt.debug.perf(): the last windowS seconds against PRD §18. The redraw is judged by p95; the rVFC callback, shorter
// than the page's timer step, by the mean.
export const perfReport = async (windowS = PERF_WINDOW_S): Promise<PerfReport> => {
  const session = getLastSession();
  const now = performance.now();
  const from = now - windowS * 1000;
  const rates = statsRates(session?.peer ?? null, windowS, now);
  const panel = await askPanel(windowS);
  const memory = session?.memory();
  const report: PerfReport = {
    windowS,
    page: {
      ...rates,
      rvfcMs: timing(perf.frameMs.since(from)),
      sampleMs: timing(perf.sampleMs.since(from)),
    },
    panel,
    memory: {
      sessionMB: memory ? round((memory.bufferBytes + memory.objectsBytes) / MB, 2) : null,
      heapMB: heapMB(),
    },
    exceeded: [],
  };
  const check = (name: string, value: number | null | undefined, limit: number) => {
    if (value !== null && value !== undefined && value > limit) {
      report.exceeded.push(`${name} ${value} > ${limit}`);
    }
  };
  check("getStatsPerS", report.page.getStatsPerS, PERF_LIMITS.getStatsPerS);
  check("otherGetStatsPer5S", report.page.otherGetStatsPer5S, PERF_LIMITS.otherGetStatsPer5S);
  check("rvfcMs mean", report.page.rvfcMs?.mean, PERF_LIMITS.rvfcMs);
  check("rendersPerS", panel?.rendersPerS, PERF_LIMITS.rendersPerS);
  check("fpsRendersPerS", panel?.fpsRendersPerS, PERF_LIMITS.fpsRendersPerS);
  check("redrawMs p95", panel?.redrawMs?.p95, PERF_LIMITS.redrawMs);
  check("sessionMB", report.memory.sessionMB, PERF_LIMITS.memoryMB);
  return report;
};

// __vtt.debug.exportSize(): the export files of the latest session made in memory, without a download — their size
// and the time it takes to make them on the page. null without a session.
export const exportSize = (): { json: { kB: number; ms: number }; csv: { kB: number; ms: number } } | null => {
  const session = getLastSession();
  if (!session) {
    return null;
  }
  const source = session.exportSource();
  const measure = (make: () => string) => {
    const begin = performance.now();
    const text = make();
    const ms = performance.now() - begin;
    return { kB: round(new Blob([text]).size / 1024, 1), ms: round(ms, 1) };
  };
  return {
    json: measure(() => jsonText(sessionJson(source))),
    csv: measure(() => sessionCsv(source)),
  };
};
