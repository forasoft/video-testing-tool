// Incoming video tracks of the page in the order they appeared: `Stream {N}` of the Report's Other streams
// (PRD §13.4). The wrapper numbers each connection's received video track at its `track` event.

// A received video track, the connection it came on (a closed one's tracks are forgotten) and its number.
interface PageTrack {
  track: MediaStreamTrack;
  peer: RTCPeerConnection;
  // 1, 2, … in the order the tracks appeared on the page.
  n: number;
}

// The numbered tracks, and the last number given: it keeps growing when tracks are forgotten.
let tracks: PageTrack[] = [];
let count = 0;

// Gives a new received video track the next number; audio tracks and a track seen before are skipped.
export const numberTrack = (peer: RTCPeerConnection, track: MediaStreamTrack): void => {
  if (track.kind !== "video" || tracks.some((known) => known.track === track)) {
    return;
  }
  count += 1;
  tracks.push({ track, peer, n: count });
};

// The number of a received video track; null when the wrapper did not see it arrive.
export const trackNumber = (track: MediaStreamTrack): number | null => tracks.find((known) => known.track === track)?.n ?? null;

// The video tracks the page still receives: the ended ones and those of closed connections are forgotten
// (their numbers are not given again).
export const pageTracks = (): PageTrack[] => {
  tracks = tracks.filter(({ track, peer }) => track.readyState !== "ended" && peer.signalingState !== "closed");
  return [...tracks];
};
