// When the streams of a connection started, for Slow start (PRD §12.3, §12.4): recorded from the
// moment the connection is created, since a session usually starts later. Times are performance.now().

// Signalling times of one connection, ms; null — not yet.
interface ConnectionTiming {
  // The latest setRemoteDescription call.
  remoteDescription: number | null;
  // The first time ICE became connected or completed.
  iceConnected: number | null;
}

// Times of one received track, ms.
interface TrackTiming {
  // The setRemoteDescription that brought the received track.
  remoteDescription: number;
  // The track's first RTP packet: a remote track is muted until it arrives, then unmutes.
  firstPacket: number | null;
}

// setRemoteDescription as the wrapper takes it: a function of any arguments, which are passed on — pages still use the
// legacy form with success and failure callbacks.
interface RemoteDescriptionTarget {
  setRemoteDescription(...args: unknown[]): Promise<void>;
}

// Weak maps: the times go when the page lets the connection or the track go.
const connections = new WeakMap<RTCPeerConnection, ConnectionTiming>();
const tracks = new WeakMap<MediaStreamTrack, TrackTiming>();

// The signalling times of a connection the wrapper watches, or null for a connection created before StreamTest.
export const connectionTiming = (peer: RTCPeerConnection): ConnectionTiming | null => connections.get(peer) ?? null;

// When a received track's description was set and its first packet came, or null for an unknown track.
export const trackTiming = (track: MediaStreamTrack): TrackTiming | null => tracks.get(track) ?? null;

const UP: RTCIceConnectionState[] = ["connected", "completed"];

// Starts recording the times of a new connection: its setRemoteDescription calls, ICE connected, and the first
// packet of each track it receives.
export const watchTiming = (peer: RTCPeerConnection): void => {
  const timing: ConnectionTiming = { remoteDescription: null, iceConnected: null };
  connections.set(peer, timing);

  const target: RemoteDescriptionTarget = peer;
  const setRemoteDescription = target.setRemoteDescription.bind(peer);
  target.setRemoteDescription = (...args: unknown[]) => {
    timing.remoteDescription = performance.now();
    return setRemoteDescription(...args);
  };

  peer.addEventListener("iceconnectionstatechange", () => {
    if (timing.iceConnected === null && UP.includes(peer.iceConnectionState)) {
      timing.iceConnected = performance.now();
    }
  });

  // The track event comes while the remote description that brought the track is being set.
  peer.addEventListener("track", ({ track }) => {
    const now = performance.now();
    const times: TrackTiming = { remoteDescription: timing.remoteDescription ?? now, firstPacket: track.muted ? null : now };
    tracks.set(track, times);
    track.addEventListener("unmute", () => {
      times.firstPacket ??= performance.now();
    });
  });
};
