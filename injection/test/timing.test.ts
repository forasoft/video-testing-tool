import { afterEach, describe, expect, it, vi } from "vitest";
import { connectionTiming, trackTiming, watchTiming } from "src/wrappers/wrap-web-rtc/timing";

type Listener = (event?: unknown) => void;

// Listeners by event type, and a way to fire them.
const target = () => {
  const listeners: Record<string, Listener[]> = {};
  return {
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = [...(listeners[type] ?? []), fn];
    },
    fire: (type: string, event?: unknown) => (listeners[type] ?? []).forEach((fn) => fn(event)),
  };
};

const fakeConnection = () => ({
  ...target(),
  iceConnectionState: "new" as RTCIceConnectionState,
  setRemoteDescription: vi.fn<(description: RTCSessionDescriptionInit) => Promise<void>>(() => Promise.resolve()),
});

const fakeTrack = (muted: boolean) => ({ ...target(), kind: "video", muted });

let now = 0;

describe("stream start timing (Slow start)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("records setRemoteDescription, the first ICE connection and the tracks' first packets", async () => {
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const pc = fakeConnection();
    const original = pc.setRemoteDescription;
    watchTiming(pc as unknown as RTCPeerConnection);

    now = 300;
    await pc.setRemoteDescription({ type: "offer", sdp: "v=0" } as RTCSessionDescriptionInit);
    expect(original).toHaveBeenCalledWith({ type: "offer", sdp: "v=0" });

    // The track event comes while the description is being set; the remote track is muted until its first packet.
    now = 305;
    const video = fakeTrack(true);
    pc.fire("track", { track: video });
    const audio = fakeTrack(false);
    pc.fire("track", { track: audio });

    now = 380;
    pc.iceConnectionState = "checking";
    pc.fire("iceconnectionstatechange");
    now = 385;
    pc.iceConnectionState = "connected";
    pc.fire("iceconnectionstatechange");
    now = 5665;
    video.fire("unmute");
    // Later changes do not move the first times.
    now = 9000;
    pc.iceConnectionState = "disconnected";
    pc.fire("iceconnectionstatechange");
    pc.iceConnectionState = "connected";
    pc.fire("iceconnectionstatechange");
    video.fire("unmute");

    expect(connectionTiming(pc as unknown as RTCPeerConnection)).toEqual({ remoteDescription: 300, iceConnected: 385 });
    expect(trackTiming(video as unknown as MediaStreamTrack)).toEqual({ remoteDescription: 300, firstPacket: 5665 });
    expect(trackTiming(audio as unknown as MediaStreamTrack)).toEqual({ remoteDescription: 300, firstPacket: 305 });
    expect(trackTiming(fakeTrack(true) as unknown as MediaStreamTrack)).toBeNull();
  });

  it("takes the track event's time when no description was set through the wrapper", () => {
    vi.spyOn(performance, "now").mockImplementation(() => now);
    const pc = fakeConnection();
    watchTiming(pc as unknown as RTCPeerConnection);

    now = 120;
    const video = fakeTrack(true);
    pc.fire("track", { track: video });

    expect(trackTiming(video as unknown as MediaStreamTrack)).toEqual({ remoteDescription: 120, firstPacket: null });
    expect(connectionTiming(pc as unknown as RTCPeerConnection)?.iceConnected).toBeNull();
  });
});
