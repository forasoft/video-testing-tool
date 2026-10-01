// When the streams of a connection started, for Slow start (PRD §12.3, §12.4): recorded from the
// moment the connection is created, since a session usually starts later. Times are performance.now().

export interface ConnectionTiming {
  // The latest setRemoteDescription call.
  remoteDescription: number | null;
  // The first time ICE became connected or completed.
  iceConnected: number | null;
}

export interface TrackTiming {
  // The setRemoteDescription that brought the received track.
  remoteDescription: number;
  // The track's first RTP packet: a remote track is muted until it arrives, then unmutes.
  firstPacket: number | null;
}

const connections = new WeakMap<RTCPeerConnection, ConnectionTiming>();
const tracks = new WeakMap<MediaStreamTrack, TrackTiming>();

export const connectionTiming = (peer: RTCPeerConnection): ConnectionTiming | null => connections.get(peer) ?? null;

export const trackTiming = (track: MediaStreamTrack): TrackTiming | null => tracks.get(track) ?? null;

const UP: RTCIceConnectionState[] = ["connected", "completed"];

export const watchTiming = (peer: RTCPeerConnection): void => {
  const timing: ConnectionTiming = { remoteDescription: null, iceConnected: null };
  connections.set(peer, timing);

  const setRemoteDescription = peer.setRemoteDescription;
  peer.setRemoteDescription = function (...args: unknown[]) {
    timing.remoteDescription = performance.now();
    return (setRemoteDescription as (...params: unknown[]) => Promise<void>).apply(peer, args);
  } as RTCPeerConnection["setRemoteDescription"];

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
      if (times.firstPacket === null) {
        times.firstPacket = performance.now();
      }
    });
  });
};
