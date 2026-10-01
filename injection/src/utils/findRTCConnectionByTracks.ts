import { CustomPeerConnection } from "src/types";
import { vttInternal } from "./connectionsObserver";

export const findRTCConnectionByTracks = (videoElement: HTMLVideoElement) => {
  //should return RTCconnection that contains all the tracks from videoElement
  const srcObject = videoElement.srcObject as MediaStream | null;
  const tracks = srcObject?.getTracks();

  if (!tracks) {
    return;
  }

  const trackIds = tracks.map((track: MediaStreamTrack) => {
    return track.id;
  });

  let theConnection: CustomPeerConnection | null = null;

  if (!vttInternal) {
    return theConnection;
  }

  for (let j = 0; j < vttInternal.length; j++) {
    const rtcPeerConnection = vttInternal[j] as CustomPeerConnection;

    let flag = true;

    if (!rtcPeerConnection.tracks) {
      continue;
    }
    const connectionTrackIds = new Set(
      rtcPeerConnection.tracks.map((track: MediaStreamTrack) => track.id)
    );
    for (let i = 0; i < trackIds.length; i++) {
      if (
        !connectionTrackIds.has(trackIds[i]) &&
        !connectionTrackIds.has(tracks[i].label)
      ) {
        flag = false;
        break;
      }
    }
    if (flag === true) {
      theConnection = rtcPeerConnection;
      break;
    }
  }
  return theConnection;
};
