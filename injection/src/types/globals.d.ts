// Replaced at build time by webpack DefinePlugin / vitest `define` with the manifest version.
declare const __VTT_VERSION__: string;

interface VttDebugApi {
  version: string;
  // idle / live / disconnected / stopped (PRD §14.3).
  state: () => import("shared/protocol").SessionState;
  // Latest per-second sample of the running session (PRD §6.3), null without a session.
  sample: () => Record<string, number | null> | null;
  // The last n values of a sample field, oldest first: __vtt.series("v_bitrate", 60).
  series: (field: import("shared/constants/sampleFields").SampleField, n: number) => (number | null)[] | null;
  // Events of the session so far (PRD §12.1), oldest first.
  events: () => import("shared/protocol").EventMessage[] | null;
  // Problems shown so far (PRD §12.3), oldest first.
  problems: () => import("shared/protocol").ProblemMessage[] | null;
  // Other streams on this page as of the last 5 s poll (PRD §13.4), the selected one among them.
  streams: () => import("shared/protocol").StreamRow[] | null;
  // Downloads the latest session as a file (PRD §15): __vtt.export("json") / __vtt.export("csv").
  // null without a session.
  export: (format?: "json" | "csv") => import("shared/protocol").ExportReadyMessage | null;
  // The load of StreamTest (plan T5.4, PRD §18).
  debug: {
    // `await __vtt.debug.perf()`: getStats() calls, the rVFC callback, the panel's renders and redraws over the last
    // windowS seconds (10 by default), the session's memory, and what goes beyond the limits of §18.
    perf: (windowS?: number) => Promise<import("src/session/debug").PerfReport>;
    // `await __vtt.debug.fastForward(3600)`: the live session runs that many seconds further at once — the samples
    // recorded so far are replayed through the buffer, the events and the detectors. null without a live session.
    fastForward: (seconds?: number) => Promise<import("src/session/session").FastForward | null>;
    // The export files of the latest session made in memory: their size, kB, and the time to make them, ms.
    exportSize: () => ReturnType<typeof import("src/session/debug").exportSize>;
  };
}

interface Window {
  __vtt: VttDebugApi;
  // The page's connections the RTCPeerConnection wrapper keeps, for debugging from the console.
  vttInternal: import("src/types/vtt-internal").VTTInternal;
}
