// The page part of StreamTest (main.js injects it into every page it runs on): it wraps RTCPeerConnection to know
// the connections the page creates from then on, answers the panel and offers the debug API `window.__vtt`.

import registerContextEvents from "src/events/context/register";
import { exportSize, perfReport } from "src/session/debug";
import { listenStoredRuns } from "src/session/lastRun";
import { exportSession, registerPopupRequests } from "src/session/requests";
import { getLastSession } from "src/session/session";
import { VTTInternal } from "types/vtt-internal";
import initWrappers from "wrappers";

import { connectionsObserver } from "./utils/connectionsObserver";

// Every RTCPeerConnection of the page, kept by the wrapper; the picked video's connection is looked up here.
const vttInternal: VTTInternal = [];

connectionsObserver(vttInternal);

initWrappers(vttInternal);

// For debugging from the page's console.
window.vttInternal = vttInternal;

// Debug API for the page console. It reads the latest session, also after it was disconnected or stopped.
window.__vtt = {
  version: __VTT_VERSION__,
  state: () => getLastSession()?.state() ?? "idle",
  sample: () => getLastSession()?.sample() ?? null,
  series: (field, n) => getLastSession()?.series(field, n) ?? null,
  events: () => getLastSession()?.events() ?? null,
  problems: () => getLastSession()?.problems() ?? null,
  streams: () => getLastSession()?.streams() ?? null,
  export: (format = "json") => exportSession(format),
  debug: {
    perf: (windowS) => perfReport(windowS),
    fastForward: (seconds = 3600) => getLastSession()?.fastForward(seconds) ?? Promise.resolve(null),
    exportSize: () => exportSize(),
  },
};

registerContextEvents();
registerPopupRequests();
listenStoredRuns();
