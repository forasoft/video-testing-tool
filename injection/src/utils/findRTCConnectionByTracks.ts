// Which of the page's RTCPeerConnections the picked <video> plays.
import { CustomPeerConnection } from "src/types";
import { vttInternal } from "./connectionsObserver";

// The connection that received every track of the video's MediaStream, or null. A received track has the id of
// the connection's track or, in some browsers, carries it as its label.
export const findRTCConnectionByTracks = (videoElement: HTMLVideoElement): CustomPeerConnection | null => {
  const tracks = (videoElement.srcObject as MediaStream | null)?.getTracks();
  // A stream without tracks (they ended or were removed) has nothing to test, and any connection would match it.
  if (!tracks?.length) {
    return null;
  }

  const connections = (vttInternal ?? []) as CustomPeerConnection[];
  const found = connections.find((connection) => {
    if (!connection.tracks) {
      return false;
    }
    const received = new Set(connection.tracks.map((track) => track.id));
    return tracks.every((track) => received.has(track.id) || received.has(track.label));
  });
  return found ?? null;
};
