import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("src/utils/postToPopup", () => ({ postToPopup: vi.fn(), postBatch: (send: () => void) => send() }));
vi.mock("src/utils/downloadFile", () => ({ downloadFile: vi.fn() }));

import { MESSAGES, SessionMessage } from "shared/protocol";
import { downloadFile } from "src/utils/downloadFile";
import { postToPopup } from "src/utils/postToPopup";
import { lastRuns } from "src/session/lastRun";
import { handlePopupRequest, registerPopupRequests } from "src/session/requests";
import {
  getActiveSession,
  getLastSession,
  MAX_STATS_ERRORS,
  SAMPLE_INTERVAL_MS,
  startSession,
} from "src/session/session";
import { watchTiming } from "src/wrappers/wrap-web-rtc/timing";
import { numberTrack } from "src/wrappers/wrap-web-rtc/tracks";
import { findStat, loadSnapshots, patchStat, toReport } from "./fixtures";

const snapshots = loadSnapshots("receive-only-loss5.json");
const [stats] = snapshots;

type Listener = (event?: unknown) => void;

// A fake receiving track that can end.
const fakeTrack = (kind: string, id: unknown) => {
  const listeners: Listener[] = [];
  return {
    kind,
    id,
    readyState: "live",
    addEventListener: (_: string, fn: Listener) => listeners.push(fn),
    removeEventListener: vi.fn(),
    end() {
      this.readyState = "ended";
      listeners.forEach((fn) => fn());
    },
  };
};

// The fixture's receiving tracks.
const makeTracks = () => [
  fakeTrack("video", findStat(stats, "inbound-rtp", "video").trackIdentifier),
  fakeTrack("audio", findStat(stats, "inbound-rtp", "audio").trackIdentifier),
];

const makeVideo = () => ({
  videoWidth: 1280,
  videoHeight: 720,
  clientWidth: 640,
  clientHeight: 360,
  readyState: 4,
  paused: false,
  srcObject: { id: "stream" } as unknown,
  getVideoPlaybackQuality: () => ({ droppedVideoFrames: 0 }),
  requestVideoFrameCallback: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

// A fake RTCPeerConnection with what the session reads and listens to.
const makeConnection = (getStats: () => Promise<RTCStatsReport>) => {
  const listeners: Record<string, Listener[]> = {};
  return {
    getStats,
    getTransceivers: (): RTCRtpTransceiver[] => [],
    getSenders: () => [{ track: null as MediaStreamTrack | null }],
    iceConnectionState: "connected",
    signalingState: "stable",
    localDescription: { sdp: "v=0 local" } as { sdp: string } | null,
    remoteDescription: { sdp: "v=0 remote" } as { sdp: string } | null,
    setRemoteDescription: vi.fn(() => Promise.resolve()),
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = [...(listeners[type] ?? []), fn];
    },
    removeEventListener: vi.fn(),
    fire: (type: string, event?: unknown) => (listeners[type] ?? []).forEach((fn) => fn(event)),
  };
};

const resolved = () => vi.fn(() => Promise.resolve(toReport(stats)));

const start = (
  getStats = resolved(),
  { tracks = makeTracks(), video = makeVideo(), onDisconnected = vi.fn() } = {}
) => {
  const pc = makeConnection(getStats);
  const session = startSession({
    peerConnection: pc as unknown as RTCPeerConnection,
    videoElement: video as unknown as HTMLVideoElement,
    tracks: tracks as unknown as MediaStreamTrack[],
    onDisconnected,
  });
  return { session, pc, tracks, video, onDisconnected, getStats };
};

const posted = (id: string) => vi.mocked(postToPopup).mock.calls.filter(([messageId]) => messageId === id).map(([, data]) => data);

describe("session", () => {
  beforeEach(() => {
    vi.mocked(postToPopup).mockClear();
    vi.mocked(downloadFile).mockClear();
    vi.useFakeTimers();
    vi.stubGlobal("document", { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() });
    vi.stubGlobal("location", { hostname: "localhost" });
    // Node has a global navigator only from version 21 on; CI runs Node 20.
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (vitest)" });
    vi.stubGlobal("window", {
      frames: {}, addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(),
    });
    lastRuns.latest = null;
    lastRuns.savedHere = false;
  });

  afterEach(() => {
    getLastSession()?.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("polls getStats once a second", async () => {
    const { getStats } = start(resolved(), { tracks: [] });

    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 3);

    expect(getStats).toHaveBeenCalledTimes(4);
    expect(getActiveSession()?.sample()?.v_w).toBe(1280);
  });

  it("sends VTT_SAMPLE once a second and VTT_FPS 4 times a second once a whole second is counted", async () => {
    start();

    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2);

    const samples = posted(MESSAGES.VTT_SAMPLE);
    const fps = posted(MESSAGES.VTT_FPS);
    expect(samples).toHaveLength(3);
    // 1000, 1250, 1500, 1750, 2000 ms
    expect(fps).toHaveLength(5);
    expect(samples[0]).toMatchObject({ t: 0, values: { v_fps_r: null } });
    expect(samples[2]).toMatchObject({ values: { v_w: 1280, v_fps_r: 0 }, goodness: { resolution: "good" } });
    // Codecs and the connection chip come with every sample.
    expect(samples[2]).toMatchObject({
      connection: { videoCodec: "VP8", audioCodec: "opus", type: "relay", goodness: "moderate" },
    });
    expect(fps[0]).toEqual({ fps: 0, goodness: "bad" });
    // Sparklines: 120 values per tile from the history buffer.
    const { sparklines } = samples[2] as { sparklines: Record<string, (number | null)[]> };
    expect(sparklines.resolution).toHaveLength(120);
    expect(sparklines.resolution.slice(-3)).toEqual([720, 720, 720]);
    expect(getActiveSession()?.series("v_w", 5)).toEqual([1280, 1280, 1280]);
  });

  it("posts the first rendered frame as a VTT_EVENT and keeps it in events()", () => {
    const video = makeVideo();
    const { session } = start(resolved(), { video });
    const onFrame = video.requestVideoFrameCallback.mock.calls[0][0] as VideoFrameRequestCallback;

    onFrame(performance.now() + 1840, { presentationTime: 0, presentedFrames: 1 } as VideoFrameCallbackMetadata);

    const events = posted(MESSAGES.VTT_EVENT);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ n: 1, kind: "first_frame", tone: "green" });
    expect(session.events()[0].label).toMatch(/^First frame 1\.8\d s$/);
  });

  it("counts the first frame from setRemoteDescription when the session caught the stream's start", () => {
    const now = vi.spyOn(performance, "now").mockReturnValue(1000);
    const pc = makeConnection(resolved());
    watchTiming(pc as unknown as RTCPeerConnection);
    const tracks = makeTracks();
    // The wrapper sees the video track arrive 0.6 s before the session; the element has no frame yet.
    pc.fire("track", { track: tracks[0] });
    now.mockReturnValue(1600);
    const video = { ...makeVideo(), readyState: 0 };
    const session = startSession({
      peerConnection: pc as unknown as RTCPeerConnection,
      videoElement: video as unknown as HTMLVideoElement,
      tracks: tracks as unknown as MediaStreamTrack[],
    });
    const onFrame = video.requestVideoFrameCallback.mock.calls[0][0] as VideoFrameRequestCallback;

    onFrame(1600 + 5650, { presentationTime: 0, presentedFrames: 1 } as VideoFrameCallbackMetadata);

    expect(session.events()[0]).toMatchObject({ t: 5.65, kind: "first_frame", label: "First frame 6.25 s" });
    now.mockRestore();
  });

  it("sends VTT_SESSION live at the start", () => {
    const { session } = start();

    expect(session.state()).toBe("live");
    const sessions = posted(MESSAGES.VTT_SESSION) as SessionMessage[];
    expect(sessions).toHaveLength(1);
    const { startedAt, ...message } = sessions[0];
    expect(startedAt).toBeTypeOf("number");
    expect(message).toEqual({ state: "live", hostname: "localhost", hasOutbound: false, hasAudio: true, otherStreamsCount: 0 });
  });

  it("keeps a null sample on a single getStats error and disconnects after 3 in a row", async () => {
    let fail = true;
    const getStats = vi.fn(() => (fail ? Promise.reject(new Error("closed")) : Promise.resolve(toReport(stats))));
    const { session, onDisconnected } = start(getStats, { tracks: [] });

    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    expect(session.sample()?.v_w).toBeNull();
    fail = false;
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    fail = true;
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * (MAX_STATS_ERRORS - 1));
    expect(onDisconnected).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    expect(onDisconnected).toHaveBeenCalledWith("getStats rejected");
    expect(session.state()).toBe("disconnected");
    expect(posted(MESSAGES.VTT_SESSION).map((m) => (m as { state: string }).state)).toEqual(["live", "disconnected"]);

    // Collection stops; the data stays.
    const calls = getStats.mock.calls.length;
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 3);
    expect(getStats).toHaveBeenCalledTimes(calls);
    expect(getActiveSession()).toBeNull();
    expect(getLastSession()?.series("t", 10)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it("disconnects when the connection was closed, although getStats still answers", async () => {
    const { session, pc, onDisconnected } = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2);

    pc.signalingState = "closed";
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);

    expect(session.state()).toBe("disconnected");
    expect(onDisconnected).toHaveBeenCalledWith("connection closed");
    expect(session.sample()?.v_w).toBe(1280);

    // The last sample is sent again with the final status: the tiles keep their values.
    const samples = posted(MESSAGES.VTT_SAMPLE) as { t: number; values: { v_w: number }; status: object; verdict: object }[];
    const [before, last] = samples.slice(-2);
    expect(samples[0].status).toEqual({ kind: "collecting", text: "Collecting data…", time: "0:00" });
    expect(last.t).toBe(before.t);
    expect(last.values.v_w).toBe(1280);
    expect(last.status).toEqual({ kind: "disconnected", text: "Stream disconnected · 0:03", time: "0:03" });
    expect(last.verdict).toEqual({
      level: "OK", degradedS: 0, worst: null, text: "No problems in 0:03", report: "No problems in 0:03.",
    });
  });

  it("disconnects at once when a track ends or ICE is closed", () => {
    const first = start();
    first.tracks[0].end();
    expect(first.session.state()).toBe("disconnected");
    expect(first.onDisconnected).toHaveBeenCalledWith("track ended");

    const second = start();
    second.pc.iceConnectionState = "closed";
    second.pc.fire("iceconnectionstatechange");
    expect(second.session.state()).toBe("disconnected");
    expect(second.onDisconnected).toHaveBeenCalledWith("connection closed");
  });

  it("disconnects when the video element gets another stream", async () => {
    const { session, video, onDisconnected } = start();

    video.srcObject = { id: "other" };
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);

    expect(session.state()).toBe("disconnected");
    expect(onDisconnected).toHaveBeenCalledWith("video source changed");
  });

  it("opens a Reconnection from ICE state changes and sends it as VTT_PROBLEM", async () => {
    const { session, pc } = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 3 + 500);
    pc.iceConnectionState = "disconnected";
    pc.fire("iceconnectionstatechange");
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 3);
    pc.iceConnectionState = "connected";
    pc.fire("iceconnectionstatechange");

    const [problem] = session.problems();
    expect(problem).toMatchObject({ id: 1, type: "reconnection", severity: "severe", tEnd: 6.5, open: false });
    // The fixture's pair got its last packet right before the report of the sample at 3 s.
    expect(problem.tStart).toBeCloseTo(3, 1);
    expect(posted(MESSAGES.VTT_PROBLEM).length).toBeGreaterThan(0);
    expect(session.events().map((e) => e.kind)).toEqual(["reconnect"]);
  });

  it("answers VTT_GET_HISTORY with the samples and the paused time, also after the session stopped", async () => {
    const video = makeVideo();
    const { session } = start(resolved(), { tracks: [], video });
    const listener = (type: string) => video.addEventListener.mock.calls.find(([name]) => name === type)?.[1] as () => void;
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2);
    listener("pause")();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 3);
    listener("playing")();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    session.stop();

    handlePopupRequest(MESSAGES.VTT_GET_HISTORY, { from: 1, to: 60 });
    // Not a time range: no answer.
    handlePopupRequest(MESSAGES.VTT_GET_HISTORY, { from: "0", to: 5 });
    handlePopupRequest(MESSAGES.VTT_GET_HISTORY, { from: 5, to: 1 });

    const answers = posted(MESSAGES.VTT_HISTORY) as { from: number; to: number; series: { t: number[] }; hiddenRanges: number[][] }[];
    expect(answers).toHaveLength(1);
    expect(answers[0]).toMatchObject({ from: 1, to: 60, hiddenRanges: [[2, 5]], events: [], problems: [] });
    expect(answers[0].series.t).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("puts a mark on the current second for VTT_MARK while live, and the paused share into the samples", async () => {
    const video = makeVideo();
    const { session } = start(resolved(), { tracks: [], video });
    const listener = (type: string) => video.addEventListener.mock.calls.find(([name]) => name === type)?.[1] as () => void;
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2 + 250);
    listener("pause")();
    handlePopupRequest(MESSAGES.VTT_MARK, {});
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2);
    listener("playing")();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);

    expect(posted(MESSAGES.VTT_EVENT)).toEqual([{ n: 1, t: 2.25, kind: "mark", label: "Mark 1", tone: "blue" }]);
    // Paused from 2.25 s to 4.25 s: the samples at 3 s and 4 s, 3/4 of the one at 3 s.
    expect(session.series("hidden", 6)).toEqual([0, 0, 0, 0.75, 1, 0.25]);

    session.stop();
    handlePopupRequest(MESSAGES.VTT_MARK, {});
    expect(session.events()).toHaveLength(1);
  });

  it("says in VTT_SAMPLE and VTT_FPS that the video is paused or the tab hidden while no frames are counted", async () => {
    const video = makeVideo();
    const documentState = { hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn() };
    vi.stubGlobal("document", documentState);
    start(resolved(), { tracks: [], video });
    const listener = (type: string) => video.addEventListener.mock.calls.find(([name]) => name === type)?.[1] as () => void;
    const onVisibility = () => documentState.addEventListener.mock.calls
      .filter(([name]) => name === "visibilitychange")
      .forEach(([, fn]) => (fn as () => void)());
    const last = (id: string) => posted(id).slice(-1)[0] as { suspended?: string };
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2);
    expect(last(MESSAGES.VTT_SAMPLE)).not.toHaveProperty("suspended");
    expect(last(MESSAGES.VTT_FPS)).not.toHaveProperty("suspended");

    listener("pause")();
    await vi.advanceTimersByTimeAsync(250);
    expect(last(MESSAGES.VTT_FPS).suspended).toBe("paused");
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS - 250);
    expect(last(MESSAGES.VTT_SAMPLE).suspended).toBe("paused");

    // A hidden tab is the reason while both hold.
    documentState.hidden = true;
    onVisibility();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    expect(last(MESSAGES.VTT_SAMPLE).suspended).toBe("hidden");
    expect(last(MESSAGES.VTT_FPS).suspended).toBe("hidden");

    documentState.hidden = false;
    onVisibility();
    listener("playing")();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    expect(last(MESSAGES.VTT_SAMPLE)).not.toHaveProperty("suspended");
    expect(last(MESSAGES.VTT_FPS)).not.toHaveProperty("suspended");
  });

  it("answers VTT_GET_REPORT with the Distribution of the latest session, also after it stopped", async () => {
    const { session } = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 3);
    session.stop();

    handlePopupRequest(MESSAGES.VTT_GET_REPORT, {});

    const [report] = posted(MESSAGES.VTT_REPORT) as { distribution: { metric: string; typical: string }[]; truncatedFrom: number | null }[];
    expect(report.truncatedFrom).toBeNull();
    expect(report.distribution.map((row) => row.metric)).toEqual([
      "Bitrate, kbps", "Frame rate, fps", "Packet loss, %", "Video delay, ms", "RTT, ms", "Freezes", "First frame",
    ]);
    // The fixture repeats one report: Δ of the counters are 0, RTT is there.
    expect(report.distribution.find((row) => row.metric === "RTT, ms")?.typical).toMatch(/^\d+$/);
    expect(report.distribution.find((row) => row.metric === "First frame")?.typical).toBe("—");
  });

  it("answers VTT_COPY_SUMMARY with the summary of the latest session as of the request", async () => {
    vi.stubGlobal("location", { hostname: "localhost", origin: "http://localhost:8080", href: "http://localhost:8080/" });
    const { session } = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2);

    handlePopupRequest(MESSAGES.VTT_COPY_SUMMARY, {});
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    session.stop();
    handlePopupRequest(MESSAGES.VTT_COPY_SUMMARY, {});

    const [live, stopped] = posted(MESSAGES.VTT_SUMMARY_TEXT) as { text: string }[];
    expect(live.text.split("\n")[0]).toMatch(/^StreamTest — localhost — \d{4}-\d{2}-\d{2} \d{2}:\d{2} — 0:02$/);
    expect(stopped.text.split("\n")[0]).toMatch(/— 0:03$/);
    expect(stopped.text.split("\n").slice(1, 3)).toEqual(["OK 0 s.", "Problems (0):"]);
    expect(stopped.text).toContain("Codecs VP8 / opus · Path relay→relay · udp · First frame —");
  });

  it("saves a run of 30 s or more as the previous run when it stops, and not a shorter one", async () => {
    const short = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 29);
    short.session.stop();
    expect(vi.mocked(window.dispatchEvent)).not.toHaveBeenCalled();

    const long = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 31 + 400);
    long.session.stop();

    const [[event]] = vi.mocked(window.dispatchEvent).mock.calls as unknown as [CustomEvent<string>][];
    expect(event.type).toBe("VTT_STORE_LAST_RUN");
    expect(JSON.parse(event.detail) as unknown).toMatchObject({ durationS: 31.4, verdict: "OK", degradedS: 0, freezes: 0 });
    // Once: a second stop saves nothing.
    long.session.stop();
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);
  });

  it("saves the run when the stream is lost or the page is left while it is live", async () => {
    const lost = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 30);
    lost.tracks[0].end();
    expect(window.dispatchEvent).toHaveBeenCalledTimes(1);

    const left = start();
    const unload = vi.mocked(window.addEventListener).mock.calls.filter(([type]) => type === "beforeunload").slice(-1)[0][1] as () => void;
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 32);
    unload();
    expect(window.dispatchEvent).toHaveBeenCalledTimes(2);
    expect((JSON.parse((vi.mocked(window.dispatchEvent).mock.calls[1][0] as CustomEvent<string>).detail) as { durationS: number }).durationS).toBe(32);
    expect(left.session.state()).toBe("live");
  });

  it("compares the next session with the saved run: the Previous run line and previousRun of the export", async () => {
    vi.stubGlobal("location", { hostname: "localhost", origin: "http://localhost:8080", href: "http://localhost:8080/" });
    const first = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 30);
    first.session.stop();
    const saved = lastRuns.latest;

    const second = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2);
    handlePopupRequest(MESSAGES.VTT_GET_REPORT, {});

    const [report] = posted(MESSAGES.VTT_REPORT) as { previousRun: { text: string }[] }[];
    expect(report.previousRun.map((p) => p.text).join("")).toBe("Previous run on this site: OK 0 s → 0 s · freezes 0 → 0 · p95 delay — → — ms · p95 loss — → — %");
    expect(second.session.exportSource().previousRun).toEqual(saved);
  });

  it("takes the previous run from storage when main.js answers the start, and says `First run` before", async () => {
    const { session } = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    handlePopupRequest(MESSAGES.VTT_GET_REPORT, {});
    lastRuns.loaded({
      startedAt: "2026-09-24T09:00:00.000Z", durationS: 64.3, verdict: "Severe", degradedS: 14.2, freezes: 3, p95DelayMs: 610, p95LossPct: 5.1, p50BitrateKbps: 1290,
    });
    handlePopupRequest(MESSAGES.VTT_GET_REPORT, {});

    const [before, after] = posted(MESSAGES.VTT_REPORT) as { previousRun: { text: string; change?: string }[] | null }[];
    expect(before.previousRun).toBeNull();
    expect(after.previousRun?.slice(0, 2)).toEqual([
      { text: "Previous run on this site: Severe 14.2 s → " }, { text: "OK 0 s", change: "better" },
    ]);
    expect(session.exportSource().previousRun?.verdict).toBe("Severe");
  });

  it("exports what it knows: a sample per poll, the SDP of the last stable state, the end of the session", async () => {
    vi.stubGlobal("location", { hostname: "localhost", origin: "http://localhost:8080", href: "http://localhost:8080/call" });
    const { session, pc } = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 3);

    const live = session.exportSource();
    expect(live).toMatchObject({
      state: "live", endedAt: null, durationS: 3, origin: "http://localhost:8080", url: "http://localhost:8080/call", hostname: "localhost",
    });
    expect(live.buffer.lastN("t", 10)).toEqual([0, 1, 2, 3]);
    expect(live.sdp).toEqual({ local: "v=0 local", remote: "v=0 remote" });
    expect(live.stream.video?.codec).toBe("VP8");
    expect(live.stream.element).toMatchObject({ clientWidth: 640, clientHeight: 360 });
    expect(live.connection.turnUrl).toBe("turn:127.0.0.1:3479?transport=udp");

    // A renegotiation: the SDP is read again once signaling is stable.
    pc.remoteDescription = { sdp: "v=0 remote 2" };
    pc.signalingState = "have-remote-offer";
    pc.fire("signalingstatechange");
    expect(session.exportSource().sdp.remote).toBe("v=0 remote");
    pc.signalingState = "stable";
    pc.fire("signalingstatechange");
    expect(session.exportSource().sdp.remote).toBe("v=0 remote 2");

    await vi.advanceTimersByTimeAsync(500);
    session.stop();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2);
    const stopped = session.exportSource();
    expect(stopped.state).toBe("stopped");
    expect(stopped.durationS).toBe(3.5);
    expect(stopped.endedAt).toBeGreaterThanOrEqual(stopped.startedAt + 3500);
  });

  it("downloads the JSON of the session for VTT_EXPORT and tells the popup, also after it stopped", async () => {
    vi.stubGlobal("location", { hostname: "localhost", origin: "http://localhost:8080", href: "http://localhost:8080/" });
    const createObjectURL = vi.spyOn(URL, "createObjectURL");
    const { session } = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2);
    session.stop();

    handlePopupRequest(MESSAGES.VTT_EXPORT, { format: "json" });

    const [[{ url, fileName }]] = vi.mocked(downloadFile).mock.calls;
    expect(fileName).toMatch(/^streamtest_localhost_\d{8}-\d{6}\.json$/);
    expect(url).toMatch(/^blob:/);
    expect(posted(MESSAGES.VTT_EXPORT_READY)).toEqual([{ format: "json", url, filename: fileName }]);
    const blob = createObjectURL.mock.calls[0][0] as Blob;
    expect(blob.type).toBe("application/json");
    const data = JSON.parse(await blob.text()) as { samples: { t: number[] }; session: { state: string } };
    expect(data.samples.t).toEqual([0, 1, 2]);
    expect(data.session.state).toBe("stopped");

    // CSV the same way; an unknown format downloads nothing.
    handlePopupRequest(MESSAGES.VTT_EXPORT, { format: "csv" });
    handlePopupRequest(MESSAGES.VTT_EXPORT, { format: "xml" });
    expect(downloadFile).toHaveBeenCalledTimes(2);
    expect(vi.mocked(downloadFile).mock.calls[1][0].fileName).toBe(fileName.replace(/json$/, "csv"));
    const csv = createObjectURL.mock.calls[1][0] as Blob;
    expect(csv.type).toBe("text/csv;charset=utf-8");
    expect((await csv.text()).split("\r\n").slice(0, 2)).toEqual(["# samples", expect.stringMatching(/^t,v_bitrate,/)]);
    expect(posted(MESSAGES.VTT_EXPORT_READY).map((m) => (m as { format: string }).format)).toEqual(["json", "csv"]);
    createObjectURL.mockRestore();
  });

  it("downloads the JSON on Download logs of the Compact header (PRD §8.2)", async () => {
    vi.stubGlobal("location", { hostname: "localhost", origin: "http://localhost:8080", href: "http://localhost:8080/" });
    const listeners: Record<string, () => void> = {};
    vi.stubGlobal("window", {
      frames: {},
      addEventListener: (type: string, fn: () => void) => {
        listeners[type] = fn;
      },
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    });
    registerPopupRequests();
    start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    listeners.VTT_DOWNLOAD_BUTTON_CLICK();

    expect(vi.mocked(downloadFile).mock.calls.map(([{ fileName }]) => fileName)).toEqual([expect.stringMatching(/^streamtest_localhost_.*\.json$/)]);
  });

  it("sends the other streams of the page every 5 s from the second poll on and keeps them for the export", async () => {
    vi.stubGlobal("document", {
      hidden: false, addEventListener: vi.fn(), removeEventListener: vi.fn(), getElementsByTagName: (): HTMLVideoElement[] => [],
    });
    const pc = makeConnection(resolved());
    const tracks = makeTracks();
    // Another call on the page receives a video track: its report is the fixture's, one per poll.
    const other = fakeTrack("video", "other-track");
    const otherReports = [0, 5, 6].map((i) => toReport(patchStat(snapshots[i], findStat(stats, "inbound-rtp", "video").id, { trackIdentifier: "other-track" })));
    let polled = 0;
    const otherPeer = {
      signalingState: "stable",
      getTransceivers: () => [{ mid: "0", receiver: { track: other } }],
      getStats: vi.fn(() => Promise.resolve(otherReports[Math.min(polled++, 2)])),
    };
    numberTrack(pc as unknown as RTCPeerConnection, tracks[0] as unknown as MediaStreamTrack);
    numberTrack(otherPeer as unknown as RTCPeerConnection, other as unknown as MediaStreamTrack);
    const session = startSession({
      peerConnection: pc as unknown as RTCPeerConnection,
      videoElement: makeVideo() as unknown as HTMLVideoElement,
      tracks: tracks as unknown as MediaStreamTrack[],
    });

    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 4);
    // The first poll only took the counters.
    expect(otherPeer.getStats).toHaveBeenCalledTimes(1);
    expect(posted(MESSAGES.VTT_STREAMS)).toEqual([]);

    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    expect(otherPeer.getStats).toHaveBeenCalledTimes(2);
    // The rows go right before the next sample: the panel draws both at once (PRD §18).
    expect(posted(MESSAGES.VTT_STREAMS)).toEqual([]);
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    const [rows] = posted(MESSAGES.VTT_STREAMS) as { name: string; selected: boolean; bitrate: number | null }[][];
    expect(rows.map(({ name, selected }) => [name, selected])).toEqual([["Stream 1", true], ["Stream 2", false]]);
    expect(rows[1].bitrate).toBeGreaterThan(1000);
    const ids = vi.mocked(postToPopup).mock.calls.map(([id]) => id);
    expect(ids[ids.indexOf(MESSAGES.VTT_STREAMS) + 1]).toBe(MESSAGES.VTT_SAMPLE);

    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 5);
    expect(posted(MESSAGES.VTT_STREAMS)).toHaveLength(2);
    expect(session.streams()).toBe(posted(MESSAGES.VTT_STREAMS)[1]);

    session.stop();
    expect(posted(MESSAGES.VTT_SESSION).pop()).toMatchObject({ state: "stopped", otherStreamsCount: 1 });
    expect(session.exportSource().streams).toBe(session.streams());
    (tracks[0] as { end: () => void }).end();
    other.end();
  });

  it("answers the panel's refreshes right before the next sample while live, its own requests at once (PRD §18)", async () => {
    const { session } = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2 + 300);

    handlePopupRequest(MESSAGES.VTT_GET_REPORT, { refresh: true });
    handlePopupRequest(MESSAGES.VTT_GET_HISTORY, {
      from: 0, to: 2, buckets: 720, refresh: true,
    });
    expect(posted(MESSAGES.VTT_REPORT)).toEqual([]);
    expect(posted(MESSAGES.VTT_HISTORY)).toEqual([]);
    handlePopupRequest(MESSAGES.VTT_GET_REPORT, {});
    expect(posted(MESSAGES.VTT_REPORT)).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    const ids = vi.mocked(postToPopup).mock.calls.map(([id]) => id).filter((id) => id !== MESSAGES.VTT_FPS).slice(-3);
    expect(ids).toEqual([MESSAGES.VTT_REPORT, MESSAGES.VTT_HISTORY, MESSAGES.VTT_SAMPLE]);
    // A refresh of the history has no events and problems: the panel has them.
    expect(posted(MESSAGES.VTT_HISTORY)[0]).toMatchObject({ events: [], problems: [] });

    // Asked before the session ended: answered when it ends; after it — at once.
    handlePopupRequest(MESSAGES.VTT_GET_REPORT, { refresh: true });
    session.stop();
    expect(posted(MESSAGES.VTT_REPORT)).toHaveLength(3);
    handlePopupRequest(MESSAGES.VTT_GET_REPORT, { refresh: true });
    expect(posted(MESSAGES.VTT_REPORT)).toHaveLength(4);
  });

  it("fastForward replays the recorded samples after the last one and moves the clock ahead (plan T5.4)", async () => {
    // Reports a second apart: the samples after the first have a bitrate, the first one is not replayed.
    let poll = 0;
    const getStats = vi.fn(() => Promise.resolve(toReport(snapshots[Math.min(poll++, snapshots.length - 1)])));
    const { session } = start(getStats);
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 31 + 400);
    const recorded = session.series("v_bitrate", 40);
    const before = posted(MESSAGES.VTT_SAMPLE).length;

    const forwarding = session.fastForward(600);
    // The replay yields to the page between its steps.
    await vi.advanceTimersByTimeAsync(10);
    const result = await forwarding;

    expect(result).toMatchObject({ seconds: 600, t: 631, samples: 632 });
    expect(result?.msPerSample).toBeGreaterThanOrEqual(0);
    expect(session.series("t", 3)).toEqual([629, 630, 631]);
    // The recorded seconds with a bitrate (the fixture has 7 reports), again and again.
    const source = recorded.filter((v) => v !== null);
    expect(recorded[0]).toBeNull();
    expect(source).toHaveLength(6);
    const replayed = session.series("v_bitrate", 600);
    expect(replayed.slice(0, 6)).toEqual(source);
    expect(replayed.slice(594)).toEqual(source);
    // The panel got the last replayed second at once.
    const samples = posted(MESSAGES.VTT_SAMPLE) as { t: number }[];
    expect(samples.slice(before).map((m) => m.t)).toEqual([631]);
    // The session goes on from the new time: the next poll is a second after the replayed ones.
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    const [last] = session.series("t", 1);
    expect(last).toBeGreaterThan(631);
    expect(last).toBeLessThan(633);
    expect(session.sample()?.v_w).toBe(1280);

    // A fast-forwarded session is not a run of the site: it is not saved as the previous run.
    session.stop();
    expect(window.dispatchEvent).not.toHaveBeenCalled();
    expect(await session.fastForward(10)).toBeNull();
  });

  it("tells the memory its data takes: the sample buffer and its objects", async () => {
    const { session } = start();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 2);

    const memory = session.memory();
    expect(memory.bufferBytes).toBe(50 * 3600 * 8);
    expect(memory.objectsBytes).toBeGreaterThan(0);
    expect(memory.objectsBytes).toBeLessThan(10_000);
  });

  it("stops on stop(): the state is stopped and the data stays", async () => {
    const { session, getStats } = start(resolved(), { tracks: [] });

    session.stop();
    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS * 3);

    expect(getStats).toHaveBeenCalledTimes(1);
    expect(getActiveSession()).toBeNull();
    expect(getLastSession()?.state()).toBe("stopped");
    expect(posted(MESSAGES.VTT_SESSION).map((m) => (m as { state: string }).state)).toEqual(["live", "stopped"]);
  });
});
