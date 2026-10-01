// One session: polls the selected connection once a second, turns each report into a sample,
// runs the problem detectors and keeps the popup informed. States — PRD §14.3.
import { SAMPLE_FIELDS, SampleField, SampleValues } from "shared/constants/sampleFields";
import {
  ConnectionInfo,
  FpsMessage,
  GetHistoryMessage,
  HistoryMessage,
  MESSAGES,
  ProblemMessage,
  ReportMessage,
  SampleMessage,
  SessionMessage,
  SessionState,
  StreamRow,
} from "shared/protocol";
import { postBatch, postToPopup } from "src/utils/postToPopup";
import { connectionTiming, trackTiming } from "src/wrappers/wrap-web-rtc/timing";
import { pageTracks } from "src/wrappers/wrap-web-rtc/tracks";
import { connectionInfo, turnAddress } from "./connection";
import { EventLog, firstFrameLabel, SampleEvents, SessionEvent, trackVisibility } from "./events";
import { ExportSource, exportMedia } from "./export/json";
import { createSelector, ElementInfo, extract, readElement, Snapshot } from "./extract";
import { FPS_WINDOW_MS, FrameClock, trackFrames } from "./frames";
import { fpsGoodness, sampleGoodness } from "./goodness";
import { SampleBuffer } from "./buffer";
import { historyMessage } from "./history";
import { LongTasks, observeLongTasks } from "./longtasks";
import { emptySample, Metrics } from "./metrics";
import { AudioStutter } from "./problems/audioStutter";
import { AvSync } from "./problems/avSync";
import { BandwidthDrop } from "./problems/bandwidthDrop";
import { Blurry } from "./problems/blurry";
import { ProblemEngine } from "./problems/engine";
import { PageJank } from "./problems/pageJank";
import { PathChanged } from "./problems/pathChanged";
import { getStats, perf } from "./perf";
import { lastPacketTime, Reconnection } from "./problems/reconnection";
import { SlowStart, StreamStart, streamOrigin } from "./problems/slowStart";
import { senderInfo, UploadLimited } from "./problems/uploadLimited";
import { MediaState, VideoFreeze } from "./problems/videoFreeze";
import {
  lastRuns, MIN_RUN_S, previousRunLine, RunSummary, runSummary,
} from "./lastRun";
import {
  DistributionSource, reportMessage, reportStats, sessionVerdict, summaryText,
} from "./report";
import { sparklines } from "./sparklines";
import { sessionStatus } from "./status";
import { elementOf, OtherStreams, STREAMS_EVERY_SAMPLES } from "./streams";
import { verdict } from "./verdict";

// A sample a second; Frame rate (VTT_FPS) is sent four times a second.
export const SAMPLE_INTERVAL_MS = 1000;
const FPS_INTERVAL_MS = 250;
// getStats() rejected this many times in a row → the stream is gone (PRD §14.5).
export const MAX_STATS_ERRORS = 3;

// __vtt.debug.fastForward() replays in steps this long, ms: shorter than a long task, so the page keeps rendering.
const FORWARD_STEP_MS = 20;

// Why a live session became disconnected (PRD §14.3).
type DisconnectReason =
  | "getStats rejected"
  | "connection closed"
  | "track ended"
  | "video source changed"
  | "not recovered";

// What a session is started on: the selected connection, its <video> and the selected stream's tracks.
interface ISessionProps {
  peerConnection: RTCPeerConnection;
  videoElement: HTMLVideoElement;
  tracks: MediaStreamTrack[];
  // A getStats() report taken just before the start (the check that the site allows it): the first poll's.
  firstReport?: RTCStatsReport;
  onDisconnected?: (reason: DisconnectReason) => void;
}

// What __vtt.debug.fastForward() did: seconds added, t of the last replayed sample, samples kept and the page's
// processing time per replayed sample, ms.
export interface FastForward {
  seconds: number;
  t: number;
  samples: number;
  msPerSample: number;
}

// V8 keeps the session's objects in about 2.3 times the length of their JSON (measured on the stand after
// fastForward(3600): 0.64 MB of heap for 0.28 MB of JSON); the estimate takes a little more.
const HEAP_PER_JSON_CHAR = 2.5;

// The session's data kept in the page, bytes: the sample buffer (typed arrays) and its objects — events,
// problems with their cards, long tasks, freezes — estimated by the length of their JSON.
interface SessionMemory {
  bufferBytes: number;
  objectsBytes: number;
}

// A session as the rest of the injection sees it: its state and data, the answers to the panel and the controls.
export interface Session {
  // The selected connection.
  peer: RTCPeerConnection;
  state: () => SessionState;
  sample: () => SampleValues | null;
  // The last n values of a sample field, oldest first.
  series: (field: SampleField, n: number) => (number | null)[];
  events: () => SessionEvent[];
  problems: () => ProblemMessage[];
  // The answer to the popup's VTT_GET_HISTORY (PRD §21).
  history: (request: GetHistoryMessage) => HistoryMessage;
  // The answer to VTT_GET_REPORT: the Distribution of the Report (PRD §13.3).
  report: () => ReportMessage;
  // The text of Copy summary as of now or of the end of the session (PRD §15.3).
  summary: () => string;
  // Other streams on this page as of the last poll (PRD §13.4); empty when there are none.
  streams: () => StreamRow[];
  // Runs `send` right before the next VTT_SAMPLE while the session is live, at once otherwise: the panel draws what
  // it sends together with the sample, once a second (PRD §18).
  withNextSample: (send: () => void) => void;
  // A mark at the current second (Mark, PRD §16 F6); only while live.
  mark: () => void;
  // Everything an export file holds (PRD §15), as of now or of the end of the session.
  exportSource: () => ExportSource;
  // Debugging (plan T5.4): `seconds` more of the session at once, and the memory its data takes.
  fastForward: (seconds: number) => Promise<FastForward | null>;
  memory: () => SessionMemory;
  stop: () => void;
}

// SDP of the connection — only for the export (PRD §6.1).
const readSdp = (pc: RTCPeerConnection): ExportSource["sdp"] => ({
  local: pc.localDescription?.sdp ?? null,
  remote: pc.remoteDescription?.sdp ?? null,
});

// What the Video freeze detector needs besides the sample: the element's state, the decoder and the last packet.
const mediaState = (snapshot: Snapshot, element: ElementInfo, lastPacketT: number | null): MediaState => {
  const decoder = snapshot.video?.decoderImplementation;
  return {
    readyState: element.readyState,
    decoder: typeof decoder === "string" && decoder !== "" ? decoder : null,
    lastPacketT,
  };
};

let lastSession: Session | null = null;

// The latest session in any state: its data is kept until the page is left.
export const getLastSession = (): Session | null => lastSession;

// The latest session while it collects data.
export const getActiveSession = (): Session | null =>
  lastSession?.state() === "live" ? lastSession : null;

// Starts a session on the selected stream: the first poll at once (on `firstReport` when given), then one a second.
export const startSession = ({
  peerConnection,
  videoElement,
  tracks,
  firstReport,
  onDisconnected,
}: ISessionProps): Session => {
  // The start in performance.now() and in ms since the epoch; fastForward moves the latter back.
  const startedAt = performance.now();
  let startedAtMs = Date.now();
  // Time skipped by __vtt.debug.fastForward(): the session's clock runs this far ahead of performance.now().
  let skippedMs = 0;
  // A performance.now() time → ms from the session start.
  const since = (now: number) => now - startedAt + skippedMs;
  // The video's source at the start: another one means the stream is gone.
  const srcObject = videoElement.srcObject;
  const selector = createSelector(peerConnection, tracks);
  const metrics = new Metrics();
  const buffer = new SampleBuffer();
  const clock = new FrameClock();
  const longTasks = new LongTasks();
  const stopLongTasks = observeLongTasks(longTasks, since);
  // null when the browser does not report long tasks.
  const tasksBetween = (from: number, to: number) => (stopLongTasks ? longTasks.between(from, to) : null);
  // Now from the session start: ms, and seconds to the ms.
  const elapsed = () => since(performance.now());
  const seconds = () => Math.round(elapsed()) / 1000;
  const events = new EventLog((event) => postToPopup(MESSAGES.VTT_EVENT, event));
  const sampleEvents = new SampleEvents(events);
  let state: SessionState = "live";
  // Read through functions: an await (getStats(), a replay step) may stop the session or start a fastForward,
  // which a check made before it does not see.
  const isLive = () => state === "live";
  // The latest sample and its VTT_SAMPLE, which a disconnect sends again with the final verdict and status.
  let lastSample: SampleValues | null = null;
  let lastMessage: SampleMessage | null = null;
  // Kept through seconds without getStats data, so that the codecs do not blink.
  let connection: ConnectionInfo | undefined;
  // When the last packet came over the selected pair, seconds from the start: the latest one known.
  let lastPacketT: number | null = null;
  // Of the latest sample: the last packet time is not carried over from older samples here.
  let media: MediaState = { readyState: null, decoder: null, lastPacketT: null };
  // getStats() rejections in a row.
  let statsErrors = 0;
  // When the previous sample was taken, ms from the session start.
  let lastPollMs = 0;
  // The end of the session: seconds from its start and ms since the epoch.
  let endedT: number | null = null;
  let endedAt: number | null = null;
  // The previous run on this site (PRD §13.1): known at the start, or when main.js answers it; this session's
  // own summary is saved once, when it ends.
  let previous: RunSummary | null = lastRuns.forSession((run) => {
    previous = run;
  });
  // This run's summary was saved, or must never be (fastForward).
  let saved = false;
  // __vtt.debug.fastForward() is replaying: the polls wait.
  let forwarding = false;
  // What goes to the panel right before the next VTT_SAMPLE while live, so that it draws both at once.
  let beforeSample: (() => void)[] = [];
  // Sends what waits for the next sample: right before it, or when the session ends.
  const flushBeforeSample = () => {
    const queued = beforeSample;
    beforeSample = [];
    queued.forEach((send) => send());
  };
  const withNextSample = (send: () => void) => {
    if (state === "live") {
      beforeSample.push(send);
    } else {
      send();
    }
  };
  // For the export: the latest getStats() data and the SDP of the last stable signaling state.
  let lastSnapshot: Snapshot | null = null;
  let sdp = readSdp(peerConnection);
  // The stream's start (Slow start): the wrapper saw it from the connection's creation on.
  const videoTrack = tracks.find((track) => track.kind === "video");
  const videoTiming = videoTrack ? trackTiming(videoTrack) : null;
  const peerTiming = connectionTiming(peerConnection);
  // Other streams of the page, polled every 5 s (PRD §13.4); polls — samples taken so far.
  const otherStreams = new OtherStreams({
    peer: peerConnection, track: videoTrack, tracks: pageTracks, element: elementOf,
  });
  let polls = 0;
  // performance.now() → seconds from the session start.
  const sinceStart = (ms: number | null | undefined) => (ms === null || ms === undefined ? null : Math.round(ms - startedAt) / 1000);
  // What the first frame is counted from, seconds; null when the stream began before the session.
  const origin = streamOrigin(sinceStart(videoTiming?.remoteDescription), videoElement.readyState);
  // The stream's start for Slow start as known now, seconds from the session start.
  const streamStart = (): StreamStart => ({
    origin,
    iceConnected: sinceStart(peerTiming?.iceConnected),
    firstPacket: sinceStart(videoTiming?.firstPacket),
    firstFrame: clock.firstFrame === null ? null : clock.firstFrame / 1000,
  });

  // Records the end of the session at t, seconds from its start.
  const end = (t: number) => {
    endedT = t;
    endedAt = Date.now();
  };

  // VTT_SESSION: the state, the start and the site, whether the connection sends media and the stream has audio,
  // and the number of other streams.
  const sendState = () => {
    const message: SessionMessage = {
      state,
      startedAt: startedAtMs,
      hostname: location.hostname,
      hasOutbound: peerConnection.getSenders().some((sender) => Boolean(sender.track)),
      hasAudio: tracks.some((track) => track.kind === "audio"),
      otherStreamsCount: otherStreams.rows.filter((row) => !row.selected).length,
    };
    postToPopup(MESSAGES.VTT_SESSION, message);
  };

  // The stream is gone: collecting stops, open problems end, the run is saved and the panel is told; once only.
  const disconnect = (reason: DisconnectReason) => {
    if (state !== "live") {
      return;
    }
    state = "disconnected";
    const t = seconds();
    end(t);
    stopCollecting();
    engine.finish(t);
    saveRun(t);
    flushBeforeSample();
    sendState();
    // The tiles keep the last values; the verdict and the status row say that the stream is gone.
    if (lastMessage) {
      const problems = engine.list();
      postToPopup(MESSAGES.VTT_SAMPLE, {
        ...lastMessage,
        verdict: sessionVerdict(problems, t),
        status: sessionStatus(problems, t, state),
      });
    }
    onDisconnected?.(reason);
  };

  // Freezes of frames.ts in seconds, as of the sample time t.
  const freezes = (t: number) =>
    clock.list(t * 1000).map((f) => ({ start: f.start / 1000, end: f.end / 1000, open: f.open }));

  // What the Report's Distribution is counted from, as of now or of the end of the session (PRD §13.3).
  const distributionSource = (): DistributionSource => {
    const t = endedT ?? seconds();
    return {
      buffer,
      t,
      freezes: freezes(t),
      suspended: clock.suspensions(t * 1000).map(({ start, end }) => ({ start: start / 1000, end: end / 1000 })),
      // As the first_frame event counts it: from the stream's start (PRD §12.1).
      firstFrameS: clock.firstFrame === null ? null : clock.firstFrame / 1000 - (origin ?? 0),
    };
  };

  // The summary of this run as of t (the end, or now while live).
  const summaryAt = (t: number): RunSummary => runSummary(startedAtMs, t, verdict(engine.list(), t), reportStats(distributionSource()));

  // A run of at least 30 s is the next one's previous run: saved when it stops, is lost or the page is left.
  const saveRun = (t: number) => {
    if (!saved && t >= MIN_RUN_S) {
      saved = true;
      lastRuns.save(summaryAt(t));
    }
  };

  // The TURN server of the selected pair, when this browser sends through a relay.
  const turnNow = () => {
    const local = lastSnapshot?.local;
    return local?.candidateType === "relay" && typeof local.url === "string" && local.url !== "" ? turnAddress(local.url) : null;
  };

  const engine = new ProblemEngine({
    buffer,
    events,
    detectors: [
      new BandwidthDrop(),
      new VideoFreeze(freezes, () => media, tasksBetween),
      new PageJank(tasksBetween),
      new PathChanged(turnNow),
      new Reconnection(),
      new UploadLimited(() => senderInfo(lastSnapshot)),
      new AudioStutter(),
      new AvSync(),
      new Blurry(),
      new SlowStart(streamStart),
    ],
    send: (message) => postToPopup(MESSAGES.VTT_PROBLEM, message),
    onEnd: () => disconnect("not recovered"),
  });

  // A sample goes into the history, the events and the problem detectors.
  const feed = (sample: SampleValues) => {
    lastSample = sample;
    buffer.push(sample);
    sampleEvents.onSample(sample);
    engine.onSample(sample, connection);
  };

  // The panel gets the sample with its grades, sparklines, verdict and status.
  const send = (sample: SampleValues, element?: ElementInfo) => {
    const t = sample.t as number;
    const problems = engine.list();
    const suspended = clock.suspendReason();
    const message: SampleMessage = {
      t,
      values: sample,
      goodness: sampleGoodness(sample, element),
      sparklines: sparklines(buffer),
      connection,
      verdict: sessionVerdict(problems, t),
      status: sessionStatus(problems, t, state),
      ...(suspended ? { suspended } : {}),
    };
    lastMessage = message;
    flushBeforeSample();
    postToPopup(MESSAGES.VTT_SAMPLE, message);
  };

  // The events, problems and answers of this second go with the sample in one VTT_BATCH.
  const publish = (sample: SampleValues, element?: ElementInfo) => postBatch(() => {
    feed(sample);
    send(sample, element);
  });

  // The stream is gone even though getStats() may still answer.
  const goneReason = (): DisconnectReason | null => {
    if (peerConnection.signalingState === "closed") {
      return "connection closed";
    }
    if (videoElement.srcObject !== srcObject) {
      return "video source changed";
    }
    if (tracks.some((track) => track.readyState === "ended")) {
      return "track ended";
    }
    return null;
  };

  // Collecting: live and not replaying recorded seconds (fastForward).
  const collecting = () => isLive() && !forwarding;

  // A second without data (getStats() rejected): a gap in the history, not the end of the session; three in a row
  // end it.
  const pollFailed = (t: number) => {
    statsErrors += 1;
    media = { ...media, lastPacketT: null };
    lastPollMs = elapsed();
    publish({ ...emptySample(), t });
    if (statsErrors >= MAX_STATS_ERRORS) {
      disconnect("getStats rejected");
    }
  };

  // The snapshot of a report with what the page counts itself: frames, freezes, the hidden share, long tasks.
  const snapshotOf = (report: RTCStatsReport, element: ElementInfo, now: number): Snapshot => {
    const snapshot = extract(report, selector);
    snapshot.element = element;
    snapshot.frames = {
      fps: now >= FPS_WINDOW_MS ? clock.fps(now) : null,
      latency: clock.latency(now),
      freezeMs: clock.freezeMs(now),
      sessionMs: now,
      hidden: clock.suspendedShare(lastPollMs, now),
    };
    snapshot.longTasks = stopLongTasks ? longTasks.drain() : null;
    return snapshot;
  };

  // The other streams of the page, every 5 samples (PRD §13.4). The first poll only takes their counters: their
  // bitrate and loss need two. The rows go with the next sample: the panel draws them together.
  const pollOtherStreams = (report: RTCStatsReport, sample: SampleValues) => {
    if (polls % STREAMS_EVERY_SAMPLES !== 0) {
      return;
    }
    const first = polls === 0;
    // It does not reject: a failing connection is left out of the rows.
    void otherStreams.poll(report, sample, lastMessage?.goodness ?? {}).then((rows) => {
      if (!first && isLive()) {
        withNextSample(() => postToPopup(MESSAGES.VTT_STREAMS, rows));
      }
    });
  };

  // `given` — a report already taken (the first poll's), else getStats() is asked.
  const poll = async (given?: RTCStatsReport) => {
    if (forwarding) {
      return;
    }
    const gone = goneReason();
    if (gone) {
      disconnect(gone);
      return;
    }
    const t = Math.round(elapsed() / 100) / 10;
    let report: RTCStatsReport;
    try {
      report = given ?? await getStats(peerConnection);
    } catch {
      // A fastForward begun while getStats() was answering replays its own seconds: no empty one goes among them.
      if (collecting()) {
        pollFailed(t);
      }
      return;
    }
    if (!collecting()) {
      return;
    }
    statsErrors = 0;
    const begin = performance.now();
    const now = elapsed();
    const element = readElement(videoElement);
    const snapshot = snapshotOf(report, element, now);
    lastSnapshot = snapshot;
    lastPollMs = now;
    const sample = metrics.next(snapshot, t);
    connection = connectionInfo(snapshot, sample.rtt);
    const packetT = lastPacketTime(snapshot.pair, t);
    lastPacketT = packetT ?? lastPacketT;
    media = mediaState(snapshot, element, packetT);
    publish(sample, element);
    pollOtherStreams(report, sample);
    polls += 1;
    const end = performance.now();
    perf.sampleMs.add(end - begin, end);
  };

  // VTT_FPS, four times a second: the Frame rate tile between samples.
  const postFps = () => {
    const now = elapsed();
    // The first second would count only part of a window.
    if (now < FPS_WINDOW_MS) {
      return;
    }
    const fps = clock.fps(now);
    const suspended = clock.suspendReason();
    const message: FpsMessage = { fps, goodness: fpsGoodness(fps), ...(suspended ? { suspended } : {}) };
    postToPopup(MESSAGES.VTT_FPS, message);
  };

  // ICE states go to the detectors (Reconnection); a closed ICE ends the session.
  const onIce = () => {
    if (peerConnection.iceConnectionState === "closed") {
      disconnect("connection closed");
      return;
    }
    engine.signal({ kind: "ice", t: seconds(), state: peerConnection.iceConnectionState, lastPacketT });
  };
  const onTrackEnded = () => disconnect("track ended");
  // The page is being left: a live session's run is saved now (lastRun.ts sends it synchronously).
  const onUnload = () => {
    if (state === "live") {
      saveRun(seconds());
    }
  };
  // The SDP for the export is taken in stable signaling states only.
  const onSignaling = () => {
    if (peerConnection.signalingState === "stable") {
      sdp = readSdp(peerConnection);
    }
  };

  sendState();
  // The first frame is counted from the stream's start when the session saw it (PRD §12.3, Slow start).
  const stopFrames = trackFrames(videoElement, clock, since, (ms) => {
    events.add(ms / 1000, "first_frame", firstFrameLabel(ms / 1000 - (origin ?? 0)), "green");
  });
  const stopVisibility = trackVisibility(events, seconds);
  peerConnection.addEventListener("iceconnectionstatechange", onIce);
  peerConnection.addEventListener("signalingstatechange", onSignaling);
  tracks.forEach((track) => track.addEventListener("ended", onTrackEnded));
  window.addEventListener("beforeunload", onUnload);
  const interval = setInterval(() => {
    void poll();
  }, SAMPLE_INTERVAL_MS);
  const fpsInterval = setInterval(postFps, FPS_INTERVAL_MS);

  // The collection stops; the buffer, events and problems stay.
  const stopCollecting = () => {
    clearInterval(interval);
    clearInterval(fpsInterval);
    stopFrames();
    stopVisibility();
    stopLongTasks?.();
    peerConnection.removeEventListener("iceconnectionstatechange", onIce);
    peerConnection.removeEventListener("signalingstatechange", onSignaling);
    tracks.forEach((track) => track.removeEventListener("ended", onTrackEnded));
    window.removeEventListener("beforeunload", onUnload);
  };

  // The ICE state the session starts in.
  engine.signal({ kind: "ice", t: 0, state: peerConnection.iceConnectionState, lastPacketT: null });
  void poll(firstReport);

  // The samples recorded so far, played again after the last one (fastForward): those with video data, or all of
  // them when none has (an audio-only stream).
  const recorded = (): SampleValues[] => {
    const all: SampleValues[] = [];
    for (let i = 0; i < buffer.size; i++) {
      const sample = {} as SampleValues;
      SAMPLE_FIELDS.forEach((field) => {
        sample[field] = buffer.at(field, i);
      });
      all.push(sample);
    }
    const withVideo = all.filter((sample) => sample.v_bitrate !== null);
    return withVideo.length ? withVideo : all;
  };

  const session: Session = {
    peer: peerConnection,
    state: () => state,
    sample: () => lastSample,
    series: (field, n) => buffer.lastN(field, n),
    events: () => [...events.events],
    problems: () => engine.list(),
    history: (request) => historyMessage({
      buffer,
      events: events.events,
      problems: engine.list(),
      // Up to the end of the session: a suspension that went on when it ended stops there.
      hidden: clock.suspensions((endedT ?? seconds()) * 1000).map(({ start, end }) => ({ start: start / 1000, end: end / 1000 })),
    }, request),
    report: () => {
      const stats = reportStats(distributionSource());
      const t = endedT ?? seconds();
      const current = runSummary(startedAtMs, t, verdict(engine.list(), t), stats);
      return reportMessage(stats, previous ? previousRunLine(previous, current) : null);
    },
    summary: () => {
      const source = distributionSource();
      return summaryText({
        hostname: location.hostname,
        startedAt: startedAtMs,
        t: source.t,
        problems: engine.list(),
        stats: reportStats(source),
        connection: connection ?? null,
      });
    },
    streams: () => otherStreams.rows,
    withNextSample,
    mark: () => {
      if (state === "live") {
        events.mark(seconds());
      }
    },
    exportSource: () => {
      const t = endedT ?? seconds();
      const problems = engine.list();
      return {
        extensionVersion: __VTT_VERSION__,
        startedAt: startedAtMs,
        endedAt,
        durationS: Math.round(t * 10) / 10,
        state,
        origin: location.origin,
        url: location.href,
        hostname: location.hostname,
        userAgent: navigator.userAgent,
        buffer,
        events: events.events,
        problems,
        verdict: verdict(problems, t),
        report: reportStats(distributionSource()),
        previousRun: previous,
        streams: otherStreams.rows,
        ...exportMedia(lastSnapshot, typeof devicePixelRatio === "number" ? devicePixelRatio : null),
        sdp,
      };
    },
    fastForward: async (seconds) => {
      const replay = recorded();
      const from = lastSample?.t;
      if (state !== "live" || forwarding || !replay.length || typeof from !== "number" || !(seconds >= 1)) {
        return null;
      }
      const count = Math.floor(seconds);
      forwarding = true;
      // Replayed seconds are not a real run: it is never saved as the previous run.
      saved = true;
      // The clock jumps at once: what happens during the replay is already on the far side of the skipped time.
      skippedMs += count * 1000;
      startedAtMs -= count * 1000;
      clock.skip(count * 1000);
      lastPollMs += count * 1000;
      let done = 0;
      let work = 0;
      while (done < count && isLive()) {
        const begin = performance.now();
        postBatch(() => {
          while (done < count && performance.now() - begin < FORWARD_STEP_MS) {
            done += 1;
            feed({ ...replay[(done - 1) % replay.length], t: Math.round((from + done) * 10) / 10, hidden: 0 });
          }
        });
        work += performance.now() - begin;
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      forwarding = false;
      // The panel shows the jump at once: the tiles, the sparklines and the status of the last replayed second.
      if (isLive() && lastSample) {
        const last = lastSample;
        postBatch(() => send(last, lastSnapshot?.element));
      }
      return {
        seconds: done, t: Math.round((from + done) * 10) / 10, samples: buffer.size, msPerSample: Math.round((work / Math.max(1, done)) * 1000) / 1000,
      };
    },
    memory: () => {
      const json = (value: unknown) => JSON.stringify(value).length;
      return {
        bufferBytes: SAMPLE_FIELDS.reduce((sum, field) => sum + buffer.columns[field].byteLength, 0),
        objectsBytes: Math.round(HEAP_PER_JSON_CHAR * (json(events.events) + json(engine.problems) + json(longTasks.tasks)
          + json(clock.closed) + json(clock.suspended))),
      };
    },
    // Close, Back to main, another stream picked: the data stays until the page is left.
    stop: () => {
      if (state === "stopped") {
        return;
      }
      if (state === "live") {
        const t = seconds();
        end(t);
        stopCollecting();
        engine.finish(t);
        saveRun(t);
      }
      state = "stopped";
      flushBeforeSample();
      sendState();
    },
  };

  lastSession = session;
  return session;
};
