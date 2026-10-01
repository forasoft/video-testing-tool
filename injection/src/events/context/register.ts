import { CustomPeerConnection } from "src/types";
import addBackgroundMessageHandler from "src/utils/events/background";
import { findRTCConnectionByTracks } from "src/utils/findRTCConnectionByTracks";
import { postToPopup } from "src/utils/postToPopup";
import { CONSTS } from "../../consts/events";
import { getStats } from "src/session/perf";
import { getLastSession, startSession } from "src/session/session";
import { findVideoRecursively } from "./resolveVideoElement";
import { registerSessionMessageHandler } from "./sessionLifecycle";
import { START_ERRORS } from "./startErrors";

// The start screen with the error; main.js opens the panel if it was hidden, so that the error is seen.
const showStartError = (error: string) => {
  postToPopup(CONSTS.VTT_GO_TO_MAIN_SCREEN, { error });
  window.dispatchEvent(new Event(CONSTS.VTT_GO_TO_MAIN_SCREEN));
};

const registerContextEvents = () => {
  // Where the page was right-clicked last: the video under it is the one to test (PRD §16 F1).
  let lastRightClickEvent: MouseEvent;

  window.oncontextmenu = (e) => {
    lastRightClickEvent = e;
  };

  // The stream is picked: a new session starts on it.
  const begin = (videoElement: HTMLVideoElement, desiredRtcPeerConnection: CustomPeerConnection, firstReport: RTCStatsReport) => {
    // Another stream picked (PRD §16 F12): the running session stops — and saves its summary as the previous
    // run — before the new one starts, and its `stopped` reaches the panel before the new session's messages.
    getLastSession()?.stop();

    postToPopup(CONSTS.CONTEXT_MENU_VTT_WAS_CLICKED, {});
    const event = new Event(CONSTS.CONTEXT_MENU_VTT_WAS_CLICKED);
    window.dispatchEvent(event);

    const tracksOnVideoElement: MediaStreamTrack[] = (
      videoElement.srcObject as MediaStream
    ).getTracks();
    const tracksInPeerConnection = desiredRtcPeerConnection.tracks;
    const tracks = tracksOnVideoElement.map(
      (trackInVideoElement) =>
        tracksInPeerConnection.find(
          (track) => track.id === trackInVideoElement.id
        ) ??
        tracksInPeerConnection.find(
          (track) => track.id === trackInVideoElement.label
        )
    );

    const session = startSession({
      peerConnection: desiredRtcPeerConnection,
      videoElement,
      tracks: tracks.filter((track): track is MediaStreamTrack => Boolean(track)),
      firstReport,
    });

    // main.js opens the panel on CONTEXT_MENU_VTT_WAS_CLICKED; Download logs is handled for the latest session in
    // requests.ts (PRD §8.2).
    registerSessionMessageHandler({ stopCalculation: session.stop });
  };

  addBackgroundMessageHandler({
    eventId: CONSTS.VTT_CONTEXT_BTN_CLICK,
    handler: () => {
      const { clientX, clientY } = lastRightClickEvent;

      const videoElement = findVideoRecursively({ clientX, clientY });

      // The start screen with the error: main.js sizes the panel for it (VTT_IS_MAIN_SCREEN).
      if (!videoElement) {
        showStartError(START_ERRORS.noVideo);
        return;
      }

      const desiredRtcPeerConnection = findRTCConnectionByTracks(videoElement);

      if (!desiredRtcPeerConnection) {
        showStartError(START_ERRORS.noConnection);
        return;
      }

      // The site may not let getStats() answer (PRD §14.2): then there is no session. The report of this check is
      // the session's first poll, so the connection is not asked twice in a second (PRD §18).
      getStats(desiredRtcPeerConnection).then(
        (report) => begin(videoElement, desiredRtcPeerConnection, report),
        () => showStartError(START_ERRORS.noStats),
      );
    },
  });
};

export default registerContextEvents;
