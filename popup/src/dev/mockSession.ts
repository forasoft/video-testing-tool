// Synthetic session for `vite dev` only (plan T2.2): the mockup's run — bandwidth drop at 0:38
// with a freeze inside, page jank at 1:02, path change to relay at 1:16, the tab hidden at
// 1:40–1:48 — sent the way the injection sends it, `speed` times faster; Mark adds a mark.
// URL: ?mock=mini|compact|expanded&speed=1|10; `&disconnect={s}` — the stream is lost at that second;
// `&tab=report` — Expanded opens on Report; `&buffer={s}` — a history this short, so that the Report of a
// session longer than it (`Showing the last 60 min of …`) is seen without waiting an hour; `&previous=none` —
// the first run on the site, without a previous one to compare with; `&streams=none` — no other streams on the page;
// `&stop={s}` — Back to main at that second: the start screen with the Last session. Back to main and Close stop the
// mock's session too. `?mock=start&error=video|connection|stats` — the start screen with an error of PRD §14.2.
// Expanded shrinks with a window narrower than 940 px or lower than 720 px, as main.js shrinks it (PRD §8.1).
// Every UI task adds the messages of its interface here (Definition of Done, plan §0).
import { SAMPLE_FIELDS, SampleField, SampleValues } from "../../../shared/constants/sampleFields";
import { groupThousands } from "../../../shared/format";
import {
  ConnectionInfo,
  EventKind,
  EventMessage,
  EventTone,
  FpsMessage,
  GetHistoryMessage,
  MESSAGES,
  PanelMode,
  ProblemCategory,
  ProblemMessage,
  SampleMessage,
  SessionMessage,
  SetModeMessage,
  Severity,
  StreamRow,
} from "../../../shared/protocol";
import { CONST } from "../CONST/const";
import { START_ERRORS } from "../../../injection/src/events/context/startErrors";
// The injection's own pure functions: the mock shows what a real session would show.
import { SampleBuffer } from "../../../injection/src/session/buffer";
import { sessionCsv } from "../../../injection/src/session/export/csv";
import {
  exportFilename, exportMedia, ExportSource, jsonText, sessionJson
} from "../../../injection/src/session/export/json";
import { fpsGoodness, sampleGoodness } from "../../../injection/src/session/goodness";
import { historyMessage } from "../../../injection/src/session/history";
import { downloadFile } from "../../../injection/src/utils/downloadFile";
import { getDataUrl } from "../../../injection/src/utils/getDataUrl";
import { sparklines } from "../../../injection/src/session/sparklines";
import {
  DistributionSource, reportMessage, reportStats, sessionVerdict, summaryText,
} from "../../../injection/src/session/report";
import { previousRunLine, RunSummary, runSummary } from "../../../injection/src/session/lastRun";
import { sessionStatus } from "../../../injection/src/session/status";
import {
  selectedGoodness, selectedValues, streamRow, StreamValues, valuesGoodness
} from "../../../injection/src/session/streams";
import { verdict } from "../../../injection/src/session/verdict";

const MODES: PanelMode[] = ["mini", "compact", "expanded"];
// The panel frame that main.js draws around the iframe in the extension.
const FRAME: Record<PanelMode, { width: number; height: number | null }> = {
  mini: { width: 190, height: null },
  compact: { width: 350, height: null },
  expanded: { width: 900, height: 700 },
};
// The selected <video> of the mockup's page.
const ELEMENT = { clientWidth: 640, clientHeight: 360 };
// Other streams of the mockup's page (PRD §13.4) and their thumbnails: the selected one is Stream 1.
const OTHER_STREAMS: { n: number; id: string; mid: string; values: (t: number) => StreamValues }[] = [
  {
    n: 2,
    id: "a41f6c1e-2b7d-4c43-9d0e-5f1c2a7b8e90",
    mid: "2",
    values: (t) => ({
      w: 640, h: 360, bitrate: 612 + noise(t, 15, 25), loss: 1.4 + noise(t, 16, 0.2), freezes: 0,
    }),
  },
  {
    n: 3,
    id: "c93b0d57-8e1a-4f26-b0c4-71d2e6a95f13",
    mid: "4",
    values: (t) => ({
      w: 1920, h: 1080, bitrate: 2240 + noise(t, 17, 60), loss: 0.12 + noise(t, 18, 0.05), freezes: 0,
    }),
  },
];
const THUMBNAIL = { clientWidth: 320, clientHeight: 180 };
// VTT_STREAMS comes every this many samples.
const STREAMS_EVERY = 5;

// ---- the scenario (seconds from the session start)

const FREEZE: [number, number] = [45.8, 48.2];
const LOW_LAYER: [number, number] = [49, 88];
const RELAY_AT = 76.5;
const HIDDEN: [number, number] = [100, 108];
// Long tasks of the page, [start s, duration ms]: the jank at 1:02 and a few short ones around it.
const LONG_TASKS: [number, number][] = [[55.3, 70], [58.1, 120], [62, 380], [66.4, 90]];

const EVENTS: { t: number; kind: EventKind; label: string; tone: EventTone }[] = [
  { t: 1.84, kind: "first_frame", label: "First frame 1.84 s", tone: "green" },
  { t: LOW_LAYER[0], kind: "layer_change", label: "720p → 360p", tone: "yellow" },
  { t: RELAY_AT, kind: "path_change", label: "Path → relay", tone: "yellow" },
  { t: LOW_LAYER[1], kind: "layer_change", label: "360p → 720p", tone: "green" },
  { t: HIDDEN[0], kind: "tab_hidden", label: "Tab hidden", tone: "gray" },
  { t: HIDDEN[1], kind: "tab_visible", label: "Tab visible", tone: "gray" },
];

// The previous run on the mockup's site (PRD §13.1).
const PREVIOUS_RUN: RunSummary = {
  startedAt: "2026-09-24T15:12:40.000Z",
  durationS: 142.5,
  verdict: "Degraded",
  degradedS: 14.2,
  freezes: 3,
  p95DelayMs: 610,
  p95LossPct: 5.1,
  p50BitrateKbps: 1290,
};

const lerp = (a: number, b: number, k: number) => a + (b - a) * Math.max(0, Math.min(1, k));

// The same noise for the same second and channel: −amp…amp.
const noise = (t: number, channel: number, amp: number): number => {
  let h = Math.imul(Math.round(t * 4) + 7, 2654435761) ^ Math.imul(channel + 1, 40503);
  h = Math.imul(h ^ (h >>> 15), 2246822507);
  h ^= h >>> 13;
  return ((h >>> 0) / 4294967296 - 0.5) * 2 * amp;
};

// A piecewise function: the first piece whose `until` is above t gives the value.
type Piece = [until: number, value: () => number];
const piecewise = (t: number, pieces: Piece[]): number =>
  (pieces.find(([until]) => t < until) ?? pieces[pieces.length - 1])[1]();

const bitrate = (t: number): number => Math.max(0, piecewise(t, [
  [1.8, () => 0],
  [8, () => lerp(0, 1800, (t - 1.8) / 6.2)],
  [38.5, () => 1800 + noise(t, 1, 70)],
  [46, () => lerp(1800, 210, (t - 38.5) / 7.5)],
  [49, () => 205 + noise(t, 1, 30)],
  [62, () => lerp(210, 700, (t - 49) / 13)],
  [76.5, () => 700 + noise(t, 1, 40)],
  [79, () => lerp(700, 520, (t - 76.5) / 2.5)],
  [88, () => lerp(520, 760, (t - 79) / 9)],
  [95, () => lerp(760, 1520, (t - 88) / 7)],
  [Infinity, () => 1540 + noise(t, 1, 60)],
]));

const channelEstimate = (t: number): number => Math.max(0, piecewise(t, [
  [6, () => lerp(300, 2400, t / 6)],
  [38, () => 2400 + noise(t, 2, 90)],
  [44, () => lerp(2400, 380, (t - 38) / 6)],
  [55, () => 400 + noise(t, 2, 40)],
  [70, () => lerp(420, 980, (t - 55) / 15)],
  [76.5, () => 980 + noise(t, 2, 50)],
  [80, () => lerp(980, 700, (t - 76.5) / 3.5)],
  [92, () => lerp(700, 1900, (t - 80) / 12)],
  [Infinity, () => 2150 + noise(t, 2, 80)],
]));

// Share of the second before t that the tab was hidden.
const hiddenShare = (t: number): number => Math.max(0, Math.min(t, HIDDEN[1]) - Math.max(t - 1, HIDDEN[0]));

// The tab is hidden at t: Frame rate and Freezes & Stalls show `—` (PRD §14.4).
const suspendedAt = (t: number): { suspended?: "hidden" } => (t >= HIDDEN[0] && t < HIDDEN[1] ? { suspended: "hidden" } : {});

const frameRate = (t: number): number => {
  // No frames are rendered while the tab is hidden.
  if (t < 1.8 || (t >= FREEZE[0] && t <= FREEZE[1]) || hiddenShare(t) === 1) {
    return 0;
  }
  return Math.max(0, Math.min(32, piecewise(t, [
    [5, () => lerp(6, 30, (t - 1.8) / 3.2)],
    [38.5, () => 30 + noise(t, 3, 0.5)],
    [45.8, () => lerp(29, 9, (t - 38.5) / 7.3)],
    [52, () => lerp(10, 24, (t - 48.2) / 3.8)],
    [61.5, () => 24.5 + noise(t, 3, 0.6)],
    [63, () => 17],
    [88, () => 24.5 + noise(t, 3, 0.7)],
    [Infinity, () => 30 + noise(t, 3, 0.4)],
  ])));
};

const loss = (t: number): number => Math.max(0, piecewise(t, [
  [8, () => 0.35 + noise(t, 4, 0.1)],
  [38.5, () => 0.22 + noise(t, 4, 0.1)],
  [43, () => lerp(0.3, 6.2, (t - 38.5) / 4.5)],
  [48, () => lerp(6.2, 2.2, (t - 43) / 5)],
  [60, () => lerp(2.2, 0.5, (t - 48) / 12)],
  [76, () => 0.35 + noise(t, 4, 0.12)],
  [80, () => lerp(0.4, 1.9, (t - 76) / 4)],
  [86, () => lerp(1.9, 0.4, (t - 80) / 6)],
  [Infinity, () => 0.25 + noise(t, 4, 0.1)],
]));

const qp = (t: number): number => piecewise(t, [
  [8, () => 34],
  [38.5, () => 28 + noise(t, 5, 0.8)],
  [46, () => lerp(28, 45, (t - 38.5) / 7.5)],
  [50, () => 45 + noise(t, 5, 1)],
  [58, () => lerp(45, 35, (t - 50) / 8)],
  [88, () => 35 + noise(t, 5, 0.9)],
  [Infinity, () => 29 + noise(t, 5, 0.8)],
]);

// Half of the RTT, ms.
const halfRtt = (t: number): number => piecewise(t, [
  [38, () => 21 + noise(t, 6, 1.5)],
  [46, () => lerp(22, 58, (t - 38) / 8)],
  [60, () => lerp(58, 26, (t - 46) / 14)],
  [76.5, () => 25 + noise(t, 6, 1.5)],
  [79, () => lerp(25, 47, (t - 76.5) / 2.5)],
  [Infinity, () => 46 + noise(t, 6, 1.6)],
]);

const jitterBuffer = (t: number): number => piecewise(t, [
  [8, () => lerp(220, 95, t / 8)],
  [38.5, () => 92 + noise(t, 7, 6)],
  [45, () => lerp(95, 620, (t - 38.5) / 6.5)],
  [52, () => lerp(620, 180, (t - 45) / 7)],
  [76, () => 150 + noise(t, 7, 10)],
  [82, () => lerp(150, 210, (t - 76) / 6)],
  [Infinity, () => lerp(210, 104, (t - 82) / 20)],
]);

const decode = (t: number): number => piecewise(t, [
  [38.5, () => 13 + noise(t, 8, 1.2)],
  [50, () => lerp(14, 29, (t - 38.5) / 11.5)],
  [88, () => 18 + noise(t, 8, 1.5)],
  [Infinity, () => 15 + noise(t, 8, 1.2)],
]);

interface ScriptedProblem {
  id: number;
  type: string;
  title: string;
  category: ProblemCategory;
  severity: Severity;
  tStart: number;
  tEnd: number;
  oneLine: string;
  // The card of PRD §12.4; its chart shows `series` (and `dashed`) of the problem ± 15 s.
  series: SampleField;
  dashed?: SampleField;
  // Bars of long tasks instead of the series (Page jank).
  bars?: [number, number][];
  rows: [string, string][];
  likelyCause: string;
  check: string;
}

const PROBLEMS: ScriptedProblem[] = [
  {
    id: 1,
    type: "bandwidth_drop",
    title: "Bandwidth drop",
    category: "Network",
    severity: "severe",
    tStart: 38.5,
    tEnd: 48.2,
    oneLine: `bitrate ${groupThousands(1800)} → 205 kbps, 1 freeze, layer 720p → 360p`,
    series: "v_bitrate",
    dashed: "avail_in",
    rows: [
      ["Bitrate", `${groupThousands(1800)} → 205 kbps`],
      ["Packet loss", "max 6.2 %"],
      ["NACK / PLI", "175 / 7"],
      ["RTT", "42 → 116 ms"],
      ["Layer", "720p → 360p"],
      ["Recovery", "40 s to 720p"],
    ],
    likelyCause: "Network between you and the sender: channel estimate fell 2.4 → 0.4 Mbit/s.",
    check: "Wi-Fi/VPN on this machine. If it happens to everyone at once — SFU or the sender's uplink.",
  },
  {
    id: 2,
    type: "video_freeze",
    title: "Video freeze",
    category: "Network",
    severity: "warn",
    tStart: 45.8,
    tEnd: 48.2,
    oneLine: "2.4 s, network",
    series: "v_fps_r",
    rows: [
      ["Duration", "2.4 s"],
      ["Frames received / decoded / rendered", "0 / 0 / 0"],
      ["Packet loss before", "5.9 %"],
      ["Bitrate before", "470 kbps"],
      ["Longest page task", "none"],
    ],
    likelyCause: "Packets stopped arriving: loss 6.2 %, bitrate fell to 205 kbps.",
    check: "Same as Bandwidth drop.",
  },
  {
    id: 3,
    type: "page_jank",
    title: "Page jank",
    category: "Page",
    severity: "warn",
    tStart: 62,
    tEnd: 63.4,
    oneLine: "main thread blocked 380 ms",
    series: "longtask_max",
    bars: LONG_TASKS,
    rows: [
      ["Longest task", "380 ms"],
      ["Frame rate", "24.5 → 17.0 fps"],
      ["Packet loss / Bitrate / RTT", "0.35 % / 700 kbps / 50 ms — normal"],
    ],
    likelyCause: "The page's JavaScript, not the stream: the main thread was busy for 380 ms while the network was fine.",
    check: "Performance profile of the page around 1:02; heavy DOM updates or timers.",
  },
  {
    id: 4,
    type: "path_changed",
    title: "Connection path changed",
    category: "Network",
    severity: "warn",
    tStart: 76.5,
    tEnd: 79.5,
    oneLine: "→ relay · udp, RTT 46 → 92 ms",
    series: "rtt",
    rows: [
      ["Path", "srflx→srflx · udp → relay→srflx · udp"],
      ["RTT", "50 → 92 ms"],
      ["Packet loss after", "0.9 %"],
      ["TURN", "turn.example.com:3478"],
    ],
    likelyCause: "The direct path failed; media now goes through a TURN relay (udp).",
    check: "UDP blocked or Wi-Fi roaming? Expect +42 ms delay while on relay.",
  },
];

// Problems shown at t: a problem appears once it has lasted 1 s, as in the injection; its chart
// has the kept samples of the problem ± 15 s.
const problemsAt = (t: number, buffer: SampleBuffer): ProblemMessage[] => PROBLEMS
  .filter((p) => t >= p.tStart + 1)
  .map(({
    series, dashed, bars, rows, likelyCause, check, ...p
  }) => {
    const from = p.tStart - 15;
    const to = Math.min(t, p.tEnd + 15);
    const times = buffer.range("t", from, to);
    const points = (field: SampleField) => ({
      name: field,
      points: buffer.range(field, from, to).map((v, i): [number, number | null] => [times[i] as number, v]),
    });
    return {
      ...p,
      tEnd: t < p.tEnd ? null : p.tEnd,
      open: t < p.tEnd,
      card: {
        series: bars
          ? { name: "longtask", kind: "bars" as const, points: bars.filter(([start]) => start >= from && start <= to) }
          : points(series),
        ...(dashed ? { dashed: points(dashed) } : {}),
        rows,
        likelyCause,
        check,
      },
    };
  });

const sampleAt = (t: number): SampleValues => {
  const s = {} as SampleValues;
  SAMPLE_FIELDS.forEach((field) => {
    s[field] = null;
  });
  const low = t >= LOW_LAYER[0] && t < LOW_LAYER[1];
  const relay = t >= RELAY_AT;
  const frozen = Math.max(0, Math.min(t, FREEZE[1]) - FREEZE[0]);
  const fps = frameRate(t);
  const dropping = t >= 38.5 && t < 48.2;

  s.t = t;
  s.v_bitrate = bitrate(t);
  s.v_fps_r = t < 1 ? null : fps;
  s.v_fps_dec = fps;
  s.v_fps_recv = fps;
  s.v_w = low ? 640 : 1280;
  s.v_h = low ? 360 : 720;
  s.v_loss = loss(t);
  s.v_jitter = 4 + noise(t, 9, 1);
  s.v_nack = dropping ? 18 : 0;
  s.v_pli = t === 41 ? 7 : 0;
  s.v_qp = qp(t);
  s.v_frames_dropped = 0;
  s.v_freeze_cnt = 0;
  s.v_freeze_ms = 0;
  s.v_freeze_pct = t > 0 ? (frozen / t) * 100 : 0;
  s.v_jb = jitterBuffer(t);
  s.v_decode = decode(t);
  s.v_render = 8 + noise(t, 10, 1);
  s.v_codec_id = 0;
  s.a_bitrate = 32 + noise(t, 11, 0.5);
  s.a_loss = loss(t) * 0.8;
  s.a_jitter = 3 + noise(t, 12, 1);
  s.a_jb = 60 + noise(t, 13, 5);
  s.a_concealed_pct = loss(t) * 0.6;
  s.av_offset = 17 + noise(t, 14, 4);
  s.rtt = 2 * halfRtt(t);
  s.avail_in = channelEstimate(t);
  s.pair_type = relay ? 3 : 1;
  s.pair_proto = 0;
  s.pair_changes = relay ? 2 : 1;
  s.d_net = halfRtt(t);
  s.d_jb = s.v_jb;
  s.d_decode = s.v_decode;
  s.d_render = s.v_render;
  s.d_video = s.d_net + s.d_jb + s.d_decode + s.d_render;
  s.d_audio = s.d_net + s.a_jb;
  s.hidden = hiddenShare(t);
  // Tasks as the injection counts them: in the sample taken after they ended.
  const tasks = LONG_TASKS.filter(([start, ms]) => start + ms / 1000 > t - 1 && start + ms / 1000 <= t).map(([, ms]) => ms);
  s.longtask_max = tasks.length ? Math.max(...tasks) : 0;
  s.longtask_sum = tasks.reduce((sum, ms) => sum + ms, 0);
  return s;
};

// The direct path fails at 1:16: from then on this browser sends through a TURN relay.
const connectionAt = (t: number, rttMs: number | null): ConnectionInfo => {
  const relay = t >= RELAY_AT;
  const localType = relay ? "relay" : "srflx";
  return {
    videoCodec: "VP8",
    audioCodec: "opus",
    localType,
    remoteType: "srflx",
    type: localType,
    proto: "udp",
    relayProtocol: relay ? "udp" : null,
    rttMs,
    tooltip: relay
      ? ["Local: relay 192.0.2.24:61020 udp", "Remote: srflx 198.51.100.4:51000 udp", "TURN: turn.example.com:3478 (udp)"]
      : ["Local: srflx 203.0.113.17:51234 udp", "Remote: srflx 198.51.100.4:51000 udp"],
    goodness: relay ? "moderate" : "good",
  };
};

// ---- sending

const post = (id: string, data: unknown) => window.postMessage({ id, data }, "*");

// main.js shrinks Expanded to the window minus 20 px when the window is smaller than this (PRD §8.1).
const EXPANDED_MIN_WINDOW = { width: 940, height: 720 };
const WINDOW_MARGIN = 20;
let framed: PanelMode | null = null;

// main.js is not there in `vite dev`: the page gets the panel's size for the mode instead.
const drawFrame = (mode: PanelMode) => {
  const root = document.getElementById("root") as HTMLElement;
  framed = mode;
  const { width, height } = mode === "expanded" ? {
    width: window.innerWidth < EXPANDED_MIN_WINDOW.width ? window.innerWidth - WINDOW_MARGIN : FRAME.expanded.width,
    height: window.innerHeight < EXPANDED_MIN_WINDOW.height ? window.innerHeight - WINDOW_MARGIN : FRAME.expanded.height,
  } : FRAME[mode];
  Object.assign(root.style, {
    top: "10px",
    left: "10px",
    right: "auto",
    width: `${width}px`,
    height: height === null ? "auto" : `${height}px`,
    background: "#f7f7f8",
    borderRadius: "10px",
    boxShadow: "0 0 1px",
    overflow: "hidden",
  });
};

const isMode = (value: string | null): value is PanelMode => MODES.includes(value as PanelMode);

const ERRORS: Record<string, string> = {
  video: START_ERRORS.noVideo,
  connection: START_ERRORS.noConnection,
  stats: START_ERRORS.noStats,
};

export const startMockSession = (): void => {
  window.addEventListener("resize", () => framed && drawFrame(framed));
  const params = new URLSearchParams(window.location.search);
  const mode = params.get("mock");
  // The start screen is drawn at the Compact size, as main.js sizes it (VTT_IS_MAIN_SCREEN).
  window.addEventListener("message", (e) => {
    if (e.data?.id === CONST.VTT_IS_MAIN_SCREEN && e.data.value) {
      drawFrame("compact");
    }
  });
  if (mode === "start") {
    drawFrame("compact");
    const error = ERRORS[params.get("error") ?? ""];
    if (error) {
      post(CONST.VTT_GO_TO_MAIN_SCREEN, { error });
    }
    return;
  }
  if (!isMode(mode)) {
    return;
  }
  const speed = Math.max(0.1, Number(params.get("speed")) || 1);
  const disconnectAt = Number(params.get("disconnect")) || null;
  const stopAt = Number(params.get("stop")) || null;
  const tab = params.get("tab") === "report" ? "report" : "timeline";
  const previous = params.get("previous") === "none" ? null : PREVIOUS_RUN;
  const others = params.get("streams") === "none" ? [] : OTHER_STREAMS;

  // The popup asks for modes with VTT_SET_MODE; here it reaches the popup itself, like main.js's answer.
  window.addEventListener("message", (e) => {
    if (e.data?.id === MESSAGES.VTT_SET_MODE && isMode((e.data.data as SetModeMessage)?.mode)) {
      drawFrame((e.data.data as SetModeMessage).mode);
    }
  });

  let session: SessionMessage = {
    state: "live",
    startedAt: Date.now(),
    hostname: "meet.example.com",
    hasOutbound: true,
    hasAudio: true,
    otherStreamsCount: 0,
  };
  post(CONST.CONTEXT_MENU_VTT_WAS_CLICKED, {});
  post(MESSAGES.VTT_SET_MODE, { mode, tab } as SetModeMessage);
  post(MESSAGES.VTT_SESSION, session);

  const buffer = new SampleBuffer(Number(params.get("buffer")) || undefined);
  let t = 0;
  const events: EventMessage[] = [];
  const sent = new Map<number, string>();
  const addEvent = (event: Omit<EventMessage, "n">) => {
    const message = { n: events.length + 1, ...event };
    events.push(message);
    post(MESSAGES.VTT_EVENT, message);
  };

  // What the Report's Distribution is counted from at `end`: the scenario's freeze, hidden tab and first frame.
  const distributionAt = (end: number): DistributionSource => ({
    buffer,
    t: end,
    freezes: end > FREEZE[0] ? [{ start: FREEZE[0], end: Math.min(end, FREEZE[1]) }] : [],
    suspended: end > HIDDEN[0] ? [{ start: HIDDEN[0], end: Math.min(end, HIDDEN[1]) }] : [],
    firstFrameS: end >= EVENTS[0].t ? EVENTS[0].t : null,
  });

  // Export (VTT_EXPORT): the files of the mock's session, made the way the injection makes them.
  const exportFile = (format: "json" | "csv") => {
    const end = Math.max(0, t - 1);
    const problems = problemsAt(end, buffer);
    const source: ExportSource = {
      extensionVersion: "dev",
      startedAt: session.startedAt,
      endedAt: session.state === "live" ? null : Date.now(),
      durationS: end,
      state: session.state,
      origin: window.location.origin,
      url: window.location.href,
      hostname: session.hostname,
      userAgent: navigator.userAgent,
      buffer,
      events,
      problems,
      verdict: verdict(problems, end),
      report: reportStats(distributionAt(end)),
      previousRun: previous,
      streams,
      ...exportMedia(null, window.devicePixelRatio),
      sdp: { local: null, remote: null },
    };
    const filename = exportFilename(source.hostname, source.startedAt, format);
    const url = format === "json"
      ? getDataUrl({ data: jsonText(sessionJson(source)), mimeType: "application/json" })
      : getDataUrl({ data: sessionCsv(source), mimeType: "text/csv;charset=utf-8" });
    downloadFile({ url, fileName: filename });
    post(MESSAGES.VTT_EXPORT_READY, { format, url, filename });
  };

  // Whole session and dragged windows (VTT_GET_HISTORY), answered from the mock's own history;
  // Mark (VTT_MARK) — a mark at the current second.
  window.addEventListener("message", (e) => {
    if (e.data?.id === MESSAGES.VTT_EXPORT && ["json", "csv"].includes(e.data.data?.format)) {
      // A moment of `Preparing…`, as a long session takes in the injection.
      window.setTimeout(() => exportFile(e.data.data.format), 400);
    }
    if (e.data?.id === MESSAGES.VTT_GET_HISTORY) {
      const source = {
        buffer, events, problems: problemsAt(t - 1, buffer), hidden: t - 1 > HIDDEN[0] ? [{ start: HIDDEN[0], end: Math.min(t - 1, HIDDEN[1]) }] : [],
      };
      post(MESSAGES.VTT_HISTORY, historyMessage(source, e.data.data as GetHistoryMessage));
    }
    // The Report (VTT_GET_REPORT): its Distribution of the mock's samples; Copy summary (VTT_COPY_SUMMARY).
    if (e.data?.id === MESSAGES.VTT_GET_REPORT) {
      const end = Math.max(0, t - 1);
      const stats = reportStats(distributionAt(end));
      const current = runSummary(session.startedAt, end, verdict(problemsAt(end, buffer), end), stats);
      post(MESSAGES.VTT_REPORT, reportMessage(stats, previous ? previousRunLine(previous, current) : null));
    }
    if (e.data?.id === MESSAGES.VTT_COPY_SUMMARY) {
      const end = Math.max(0, t - 1);
      post(MESSAGES.VTT_SUMMARY_TEXT, {
        text: summaryText({
          hostname: session.hostname,
          startedAt: session.startedAt,
          t: end,
          problems: problemsAt(end, buffer),
          stats: reportStats(distributionAt(end)),
          connection: connectionAt(end, 2 * halfRtt(end)),
        }),
      });
    }
    if (e.data?.id === MESSAGES.VTT_MARK) {
      const marks = events.filter((event) => event.kind === "mark").length;
      addEvent({
        t: Math.max(0, t - 1), kind: "mark", label: `Mark ${marks + 1}`, tone: "blue",
      });
    }
  });

  // Each problem again whenever its message changed, as the injection sends it.
  const sendProblems = (problems: ProblemMessage[]) => problems.forEach((problem) => {
    const text = JSON.stringify(problem);
    if (sent.get(problem.id) !== text) {
      sent.set(problem.id, text);
      post(MESSAGES.VTT_PROBLEM, problem);
    }
  });

  const timers: number[] = [];
  let last: SampleMessage | null = null;
  // The latest VTT_STREAMS: the selected stream's row has the values of its tiles.
  let streams: StreamRow[] = [];
  const streamsAt = (message: SampleMessage): StreamRow[] => (others.length ? [
    streamRow({
      n: 1, trackId: "5d0b1f2e-7c34-4a8e-9f61-2e8c4b7a0d35", mid: "0", selected: true, values: selectedValues(message.values), goodness: selectedGoodness(message.goodness),
    }),
    ...others.map(({
      n, id, mid, values,
    }) => {
      const v = values(message.t);
      return streamRow({
        n, trackId: id, mid, selected: false, values: v, goodness: valuesGoodness(v, THUMBNAIL),
      });
    }),
  ] : []);

  // The stream is lost: open problems end now, the last sample comes again with the final verdict
  // and status, and nothing more is sent (PRD §14.3, §21).
  const disconnect = () => {
    timers.forEach((timer) => window.clearInterval(timer));
    const end = t - 1;
    const problems = problemsAt(end, buffer).map((p) => (p.open ? { ...p, tEnd: end, open: false } : p));
    sendProblems(problems);
    session = { ...session, state: "disconnected" };
    post(MESSAGES.VTT_SESSION, session);
    if (last) {
      post(MESSAGES.VTT_SAMPLE, { ...last, verdict: sessionVerdict(problems, end), status: sessionStatus(problems, end, "disconnected") });
    }
  };

  // Back to main, Close (PRD §14.3 `stopped`): the collection stops, the data stays for the Last session.
  const stop = () => {
    if (session.state !== "live") {
      return;
    }
    timers.forEach((timer) => window.clearInterval(timer));
    session = { ...session, state: "stopped" };
    post(MESSAGES.VTT_SESSION, session);
  };
  window.addEventListener("message", (e) => {
    if (e.data?.id === CONST.VTT_STOP_CALCULATION) {
      stop();
    }
    // Close in Expanded: main.js would hide the panel; here the start screen shows at once, as when it is opened again.
    if (e.data?.id === CONST.VTT_HIDE) {
      stop();
      post(CONST.VTT_WAS_HIDDEN, {});
    }
  });

  const tick = () => {
    if (disconnectAt !== null && t > disconnectAt) {
      disconnect();
      return;
    }
    if (stopAt !== null && t > stopAt) {
      stop();
      post(CONST.VTT_GO_TO_MAIN_SCREEN, {});
      return;
    }
    EVENTS.filter((event) => event.t > t - 1 && event.t <= t).forEach(addEvent);
    const values = sampleAt(t);
    buffer.push(values);
    const problems = problemsAt(t, buffer);
    sendProblems(problems);
    const message: SampleMessage = {
      t,
      values,
      goodness: sampleGoodness(values, ELEMENT),
      sparklines: sparklines(buffer),
      connection: connectionAt(t, values.rtt),
      verdict: sessionVerdict(problems, t),
      status: sessionStatus(problems, t, "live"),
      ...suspendedAt(t),
    };
    last = message;
    post(MESSAGES.VTT_SAMPLE, message);
    // Other streams every 5 s, from the second poll on, as the injection sends them.
    if (t > 0 && t % STREAMS_EVERY === 0) {
      streams = streamsAt(message);
      post(MESSAGES.VTT_STREAMS, streams);
    }
    t += 1;
  };
  tick();
  timers.push(window.setInterval(tick, 1000 / speed));

  // Frame rate four times a second, from the end of the first second.
  let quarter = 0;
  timers.push(window.setInterval(() => {
    quarter += 1;
    const time = quarter / 4;
    if (time >= 1) {
      const fps = Math.round(frameRate(time));
      const message: FpsMessage = { fps, goodness: fpsGoodness(fps), ...suspendedAt(time) };
      post(MESSAGES.VTT_FPS, message);
    }
  }, 250 / speed));
};
