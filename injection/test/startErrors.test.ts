import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("src/utils/postToPopup", () => ({ postToPopup: vi.fn(), postBatch: (send: () => void) => send() }));

import { EVENTS } from "shared/constants/events";
import { MESSAGES } from "shared/protocol";
import registerContextEvents from "src/events/context/register";
import { START_ERRORS } from "src/events/context/startErrors";
import { getLastSession, SAMPLE_INTERVAL_MS } from "src/session/session";
import { connectionsObserver } from "src/utils/connectionsObserver";
import { postToPopup } from "src/utils/postToPopup";
import { findStat, loadSnapshots, toReport } from "./fixtures";

const [stats] = loadSnapshots("receive-only-loss5.json");

type Listener = (event: unknown) => void;

class FakeVideo {
  style = { display: "" };
  children: unknown[] = [];
  srcObject: unknown;
  videoWidth = 1280;
  videoHeight = 720;
  clientWidth = 640;
  clientHeight = 360;
  readyState = 4;
  paused = false;

  constructor(tracks: unknown[]) {
    this.srcObject = { getTracks: () => tracks };
  }

  getBoundingClientRect() {
    return {
      left: 0, top: 0, right: 640, bottom: 360,
    };
  }

  getVideoPlaybackQuality() {
    return { droppedVideoFrames: 0 };
  }

  requestVideoFrameCallback = vi.fn();
  addEventListener = vi.fn();
  removeEventListener = vi.fn();
}

const fakeTrack = (kind: string, id: unknown) => ({
  kind, id, label: "", readyState: "live", addEventListener: vi.fn(), removeEventListener: vi.fn(),
});

const makeTracks = () => [
  fakeTrack("video", findStat(stats, "inbound-rtp", "video").trackIdentifier),
  fakeTrack("audio", findStat(stats, "inbound-rtp", "audio").trackIdentifier),
];

const makeConnection = (tracks: unknown[], getStats: () => Promise<RTCStatsReport>) => ({
  tracks,
  getStats: vi.fn(getStats),
  getTransceivers: (): RTCRtpTransceiver[] => [],
  getSenders: (): RTCRtpSender[] => [],
  iceConnectionState: "connected",
  signalingState: "stable",
  localDescription: null as RTCSessionDescription | null,
  remoteDescription: null as RTCSessionDescription | null,
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
});

// Start errors, PRD §14.2: a red line under the steps instead of alert(); the panel opens to show it.
describe("picking a stream", () => {
  let listeners: Listener[];
  let videos: FakeVideo[];
  const dispatchEvent = vi.fn();

  // The extension's menu item: the last right-click, then VTT_CONTEXT_BTN_CLICK from the background.
  const clickTestStream = () => {
    (window as unknown as { oncontextmenu: Listener }).oncontextmenu({ clientX: 100, clientY: 100 });
    listeners.forEach((fn) => fn({ source: window, data: { id: EVENTS.VTT_CONTEXT_BTN_CLICK } }));
  };

  const posted = (id: string) => vi.mocked(postToPopup).mock.calls.filter(([messageId]) => messageId === id).map(([, data]) => data);

  beforeEach(() => {
    vi.mocked(postToPopup).mockClear();
    dispatchEvent.mockClear();
    vi.useFakeTimers();
    listeners = [];
    videos = [];
    vi.stubGlobal("HTMLVideoElement", FakeVideo);
    vi.stubGlobal("location", { hostname: "localhost", origin: "http://localhost", href: "http://localhost/" });
    vi.stubGlobal("document", {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      getElementsByTagName: () => videos,
    });
    vi.stubGlobal("window", {
      frames: {},
      addEventListener: (type: string, fn: Listener) => {
        if (type === "message") {
          listeners.push(fn);
        }
      },
      removeEventListener: vi.fn(),
      dispatchEvent,
    });
    connectionsObserver([]);
    registerContextEvents();
  });

  afterEach(() => {
    getLastSession()?.stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("says that there is no video under the cursor, and main.js opens the panel", () => {
    clickTestStream();

    expect(posted(EVENTS.VTT_GO_TO_MAIN_SCREEN)).toEqual([{ error: START_ERRORS.noVideo }]);
    expect(dispatchEvent.mock.calls.map(([event]) => (event as Event).type)).toEqual([EVENTS.VTT_GO_TO_MAIN_SCREEN]);
    expect(START_ERRORS.noVideo).toBe("No video under the cursor. Right-click directly on a participant's video.");
  });

  it("says that the video has no WebRTC connection", () => {
    videos.push(new FakeVideo(makeTracks()));

    clickTestStream();

    expect(posted(EVENTS.VTT_GO_TO_MAIN_SCREEN)).toEqual([{ error: START_ERRORS.noConnection }]);
    expect(START_ERRORS.noConnection).toBe("No WebRTC connection found for this video. It may not be a WebRTC stream, or it was created before the page loaded.");
  });

  it("does not start a session when the site does not let getStats answer", async () => {
    const tracks = makeTracks();
    videos.push(new FakeVideo(tracks));
    connectionsObserver([makeConnection(tracks, () => Promise.reject(new Error("denied"))) as unknown as RTCPeerConnection]);
    const before = getLastSession();

    clickTestStream();
    await vi.advanceTimersByTimeAsync(0);

    expect(posted(EVENTS.VTT_GO_TO_MAIN_SCREEN)).toEqual([{ error: START_ERRORS.noStats }]);
    expect(START_ERRORS.noStats).toBe("This site does not allow reading connection statistics.");
    expect(posted(EVENTS.CONTEXT_MENU_VTT_WAS_CLICKED)).toEqual([]);
    expect(getLastSession()).toBe(before);
  });

  it("starts the session on the checked stream: the check's report is its first poll", async () => {
    const tracks = makeTracks();
    videos.push(new FakeVideo(tracks));
    const pc = makeConnection(tracks, () => Promise.resolve(toReport(stats)));
    connectionsObserver([pc as unknown as RTCPeerConnection]);

    clickTestStream();
    await vi.advanceTimersByTimeAsync(0);

    expect(posted(EVENTS.VTT_GO_TO_MAIN_SCREEN)).toEqual([]);
    expect(posted(EVENTS.CONTEXT_MENU_VTT_WAS_CLICKED)).toHaveLength(1);
    expect(getLastSession()?.state()).toBe("live");
    expect(pc.getStats).toHaveBeenCalledTimes(1);
    expect(posted(MESSAGES.VTT_SAMPLE)).toHaveLength(1);
    expect(getLastSession()?.sample()?.v_w).toBe(1280);

    await vi.advanceTimersByTimeAsync(SAMPLE_INTERVAL_MS);
    expect(pc.getStats).toHaveBeenCalledTimes(2);
    expect(posted(MESSAGES.VTT_SAMPLE)).toHaveLength(2);
  });
});
