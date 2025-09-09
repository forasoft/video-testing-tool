import { CustomPeerConnection } from "src/types";
import { vttInternal } from "./connectionsObserver";

export const findRTCConnectionByTracks = (videoElement: any) => {
  //should return RTCconnection that contains all the tracks from videoElement
  const tracks = videoElement.srcObject.getTracks();

  if (!tracks) {
    return;
  }

  const trackIds = tracks.map((track: MediaStreamTrack) => {
    return track.id;
  });

  let theConnection: CustomPeerConnection | null = null;

  for (let j = 0; j < vttInternal.length; j++) {
    const rtcPeerConnection: any = vttInternal[j];

    let flag = true;

    if (!rtcPeerConnection.tracks) {
      continue;
    }
    const connectionTracks = rtcPeerConnection.tracks.map(
      (track: MediaStreamTrack) => {
        return track.id;
      }
    );
    for (let i = 0; i < trackIds.length || 0; i++) {
      if (
        !connectionTracks.includes(trackIds[i]) &&
        !connectionTracks.includes(tracks[i].label)
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
  if (!theConnection) {
    console.log(
      "Скорее всего в vttInternal нет нужного rtcPeerConnection или в нужном rtcPeerConnection нет нужных треков)"
    );
  }

  return theConnection;
};
