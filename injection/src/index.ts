// internal Video testing tool's data

import registerContextEvents from "src/events/context/register";
import { exportSize, perfReport } from "src/session/debug";
import { listenStoredRuns } from "src/session/lastRun";
import { exportSession, registerPopupRequests } from "src/session/requests";
import { getLastSession } from "src/session/session";
import { VTTInternal } from "types/vtt-internal";
import initWrappers from "wrappers";

import { connectionsObserver } from "./utils/connectionsObserver";

const vttInternal: VTTInternal = [];

connectionsObserver(vttInternal);

initWrappers(vttInternal);

// add vttInternal to window for debugging
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(<any>window).vttInternal = vttInternal;

// Debug API for the page console; later tasks add commands here. It reads the latest
// session, also after it was disconnected or stopped.
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

console.log(`Video testing tool ${__VTT_VERSION__} initialized`);


