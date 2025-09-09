import addBackgroundMessageHandler from "src/utils/events/background";
import { findRTCConnectionByTracks } from "src/utils/findRTCConnectionByTracks";
import { postToPopup } from "src/utils/postToPopup";
import { Queue } from "src/utils/queue";
import AverageDelaysGenerator from "src/utils/AverageDelaysGenerator";
import { CONSTS } from "../../consts/events";
import { Candidates, StatisticsReportItem } from "src/types";
import { downloadFile } from "src/utils/downloadFile";
import { getDataUrl } from "src/utils/getDataUrl";
import { createReportTableInCsv } from "src/utils/createReportTableInCsv";

const isHidden = (element: HTMLElement) => element.style.display === "none";

const includesPoint = (
  element: HTMLElement,
  clientX: number,
  clientY: number
): boolean => {
  if (isHidden(element)) {
    return false;
  }

  const rect = element.getBoundingClientRect();

  return (
    rect.left <= clientX &&
    clientX <= rect.right &&
    rect.top <= clientY &&
    clientY <= rect.bottom
  );
};

interface IFindProps {
  clientX: number;
  clientY: number;
  elements?: HTMLElement[];
}
const findVideoRecursively = (
  props: IFindProps
): HTMLVideoElement | undefined => {
  const {
    clientX,
    clientY,
    elements = document.getElementsByTagName("video"),
  } = props;

  for (let i = 0; i != elements.length; ++i) {
    const currentElement = elements[i];
    if (
      currentElement instanceof HTMLVideoElement
      && includesPoint(currentElement, clientX, clientY)
      && currentElement.srcObject !== null
    ) {
      return currentElement;
    }

    const videoElement = findVideoRecursively({
      clientX,
      clientY,
      elements: [].slice.call(currentElement.children),
    });

    if (videoElement) {
      return videoElement;
    }
  }
};

const registerContextEvents = () => {
  let lastRightClickEvent: MouseEvent | { clientX: number; clientY: number };

  window.oncontextmenu = (e) => {
    lastRightClickEvent = e;
  };

  window.addEventListener("message", (event) => {
    if (event.data.id === CONSTS.PROVIDE_COORDS)
      lastRightClickEvent = {
        clientX: event.data.clientX,
        clientY: event.data.clientY,
      };
  });

  addBackgroundMessageHandler({
    eventId: CONSTS.VTT_CONTEXT_BTN_CLICK,
    handler: () => {
      const startAt = new Date();
      const statsLog: StatisticsReportItem[] = [];
      const GET_STATISTICS_REPORT_ITEM_INTERVAL_MS = 1000 * 10;

      const { clientX, clientY } = lastRightClickEvent;

      const videoElement: any = findVideoRecursively({ clientX, clientY });

      if (!videoElement) {
        const event = new Event(CONSTS.VTT_SET_FULL_SIZE);
        window.dispatchEvent(event);
        postToPopup(CONSTS.VTT_GO_TO_MAIN_SCREEN, {
          error: "Please select a video container.",
        });
        return;
      }

      const desiredRtcPeerConnection = findRTCConnectionByTracks(videoElement);

      if (!desiredRtcPeerConnection) {
        const event = new Event(CONSTS.VTT_SET_FULL_SIZE);
        window.dispatchEvent(event);
        postToPopup(CONSTS.VTT_GO_TO_MAIN_SCREEN, {
          error: "There is no rctPeerConnection for your media element",
        });
        return;
      }

      postToPopup(CONSTS.CONTEXT_MENU_VTT_WAS_CLICKED, {});
      const event = new Event(CONSTS.CONTEXT_MENU_VTT_WAS_CLICKED);
      window.dispatchEvent(event);

      const COMPUTING_DELAYS_INTERVAL_MS = 150;
      const STATS_UPDATE_INTERVAL_MS = 150;

      const fpsQueue = new Queue(10);
      const dtTimestampsQueue = new Queue(30);

      let totalFreezesDuration = 0;

      const VideoJBDQueue = new AverageDelaysGenerator(2);
      const AudioJBDQueue = new AverageDelaysGenerator(2);
      const VideoRTTQueue = new AverageDelaysGenerator(3);
      const AudioRTTQueue = new AverageDelaysGenerator(3);

      const tracksOnVideoElement: MediaStreamTrack[] =
        videoElement.srcObject.getTracks();
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

      const mapCodecIdToName: Record<string, string> = {};
      const reserveValues = ["rtx", "red", "ulpfec"];
      const codecs: Record<string, Set<string>> = {
        audio: new Set<string>(),
        video: new Set<string>(),
      };

      Promise.all(
        tracks.map(async (track: MediaStreamTrack) => {
          const stats = await desiredRtcPeerConnection.getStats(track);

          stats.forEach((report) => {
            if (report.type === "codec") {
              const [type, codec] = report.mimeType.split("/");

              if (reserveValues.includes(codec)) {
                return;
              }

              mapCodecIdToName[report.id] = codec;
            }

            if (report.type === "inbound-rtp" && report.codecId) {
              codecs[report.mediaType].add(mapCodecIdToName[report.codecId]);
            }
          });
        })
      ).then(() => {
        postToPopup(CONSTS.PROVIDE_CDECS, { codecs });
      });

      let initialTotalPacketsLost: number;
      let initialTotalPacketsSent: number;

      let lastValueBytesReceived = 0;
      let lastValueTimestamp = new Date().getTime();

      let IntervalComputingDelays = setInterval(() => {
        for (let i = 0; i < tracks.length; i++) {
          const track = tracks[i];

          if (!track) {
            continue;
          }

          const isAudioTrack = track.kind === "audio";
          const JBDQueue = isAudioTrack ? AudioJBDQueue : VideoJBDQueue;
          const RTTQueue = isAudioTrack ? AudioRTTQueue : VideoRTTQueue;

          desiredRtcPeerConnection
            .getStats(track)
            .then((stats) => {
              //delay
              let jitterBufferDelay = null;
              let jitterBufferEmittedCount = null;
              let totalRoundTripTime = null;
              let responsesReceived = null;
              stats.forEach((report) => {
                Object.keys(report).forEach((statName) => {
                  if (statName === "jitterBufferDelay") {
                    jitterBufferDelay = report[statName];
                    return;
                  }
                  if (statName === "jitterBufferEmittedCount") {
                    jitterBufferEmittedCount = report[statName];
                    return;
                  }
                  if (statName === "totalRoundTripTime") {
                    totalRoundTripTime = report[statName];
                    return;
                  }
                  if (statName === "responsesReceived") {
                    responsesReceived = report[statName];
                    return;
                  }
                });
              });
              if (jitterBufferDelay && jitterBufferEmittedCount) {
                JBDQueue.smartPrepand({
                  realDelay: jitterBufferDelay,
                  realCount: jitterBufferEmittedCount,
                });
              }
              if (totalRoundTripTime && responsesReceived) {
                RTTQueue.smartPrepand({
                  realDelay: totalRoundTripTime,
                  realCount: responsesReceived,
                });
              }
            })
            .catch(() => {
              const event = new Event(CONSTS.VTT_SET_FULL_SIZE);
              window.dispatchEvent(event);
              postToPopup(CONSTS.ERROR_GET_STATS, {});
              stopCalculation();
            });
        }
        desiredRtcPeerConnection.getStats().then((stats) => {
          let totalPacketsLost = 0;
          let totalPacketsSent = 0;
          let totalBytesReceived = 0;
          let timestamp = lastValueTimestamp;

          stats.forEach((report) => {
            Object.keys(report).forEach((statName) => {
              if (statName === "packetsLost") {
                totalPacketsLost += report[statName];
              }
              if (statName === "packetsSent") {
                totalPacketsSent += report[statName];
              }
            });

            if (
              report.type === "inbound-rtp" &&
              report.mediaType === "video" &&
              report.codecId
            ) {
              totalBytesReceived += report.bytesReceived;

              if (report.timestamp > timestamp) {
                timestamp = report.timestamp;
              }
            }
          });

          if (
            initialTotalPacketsLost === undefined ||
            initialTotalPacketsSent === undefined
          ) {
            initialTotalPacketsLost = totalPacketsLost;
            initialTotalPacketsSent = totalPacketsSent;
          } else {
            const diffPacketsLost = totalPacketsLost - initialTotalPacketsLost;
            const diffPacketsSent = totalPacketsSent - initialTotalPacketsSent;

            if (diffPacketsSent > 0 && diffPacketsLost >= 0) {
              postToPopup(CONSTS.PROVIDE_PACKET_LOSS, {
                packetLoss: (diffPacketsLost / diffPacketsSent) * 100,
              });
            }
          }

          if (timestamp > lastValueTimestamp) {
            const bitrate =
              lastValueBytesReceived === 0
                ? 0
                : (totalBytesReceived - lastValueBytesReceived) /
                  (timestamp - lastValueTimestamp);

            lastValueBytesReceived = totalBytesReceived;
            lastValueTimestamp = timestamp;

            postToPopup(CONSTS.PROVIDE_BITRATE, { bitrate });
          }
        });
      }, COMPUTING_DELAYS_INTERVAL_MS);

      let wasDocumentJustHidden = false;
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden) {
          wasDocumentJustHidden = true;
          return;
        }
        setTimeout(() => {
          wasDocumentJustHidden = false;
        }, 200);
      });

      let flagSameFreeze = false;
      let TotalIncreasedWhileNoFrames = 0;
      let lastModifiedTFDTimestamp = Date.now();

      let statsInterval = setInterval(() => {
        const dT = Date.now() - dtTimestampsQueue.lastSmartAppendTimestamp;
        if (dT > 3000 && !document.hidden) {
          const increasedBy = flagSameFreeze
            ? dT - TotalIncreasedWhileNoFrames
            : dT;
          totalFreezesDuration += increasedBy;
          TotalIncreasedWhileNoFrames += increasedBy;
          lastModifiedTFDTimestamp = Date.now();
          flagSameFreeze = true;
          postToPopup(CONSTS.PROVIDE_FPS, { fps: 0.0 });
        } else {
          const averageFps = fpsQueue.getAverage();
          postToPopup(CONSTS.PROVIDE_FPS, { fps: averageFps });
        }

        const width: number = videoElement.videoWidth;
        const height: number = videoElement.videoHeight;
        const elementWidth = videoElement.clientWidth;
        const elementHeight = videoElement.clientHeight;

        postToPopup(CONSTS.PROVIDE_RESOLUTION, {
          width,
          height,
          elementWidth,
          elementHeight,
        });

        postToPopup(CONSTS.PROVIDE_FREEZES, {
          freezesDuration:
            (totalFreezesDuration / (Number(new Date()) - Number(startAt))) *
            100,
        });
        postToPopup(CONSTS.PROVIDE_VIDEO_DELAY, {
          delay:
            (VideoJBDQueue.getAverageJBD() +
              VideoRTTQueue.getAverageJBD() / 2) *
            1000,
        });
        postToPopup(CONSTS.PROVIDE_AUDIO_DELAY, {
          delay:
            (AudioJBDQueue.getAverageJBD() +
              AudioRTTQueue.getAverageJBD() / 2) *
            1000,
        });
      }, STATS_UPDATE_INTERVAL_MS);

      let statsForReportInterval = setInterval(() => {
        desiredRtcPeerConnection.getStats().then((stats) => {
          const candidates: Candidates = {};

          stats.forEach((report) => {
            if (
              report.type === "candidate-pair" &&
              report.state === "succeeded" &&
              report.nominated &&
              (!candidates.priority || report.priority > candidates.priority)
            ) {
              candidates.priority = Number(report.priority);
              candidates.local = { id: report.localCandidateId };
              candidates.remote = { id: report.remoteCandidateId };
            }

            if (
              report.type === "local-candidate" &&
              report.id === candidates.local.id
            ) {
              candidates.local = report;
            }
            if (
              report.type === "remote-candidate" &&
              report.id === candidates.remote.id
            ) {
              candidates.remote = report;
            }
          });

          const iceConnectionState =
            desiredRtcPeerConnection.iceConnectionState;
          const iceGatheringState = desiredRtcPeerConnection.iceGatheringState;

          statsLog.push({
            timestamp: Date.now(),
            candidates,
            iceConnectionState,
            iceGatheringState,
            stats,
          });
        });
      }, GET_STATISTICS_REPORT_ITEM_INTERVAL_MS);

      const stopCalculation = () => {
        clearInterval(statsInterval);
        statsInterval = null;
        clearInterval(IntervalComputingDelays);
        IntervalComputingDelays = null;
        clearInterval(statsForReportInterval);
        statsForReportInterval = null;
      };

      let lastTime = Date.now();
      const addFpsToList = () => {
        TotalIncreasedWhileNoFrames = 0;

        const myNow = Date.now();
        const dt = (myNow - lastTime) / 1000;

        if (
          !wasDocumentJustHidden &&
          dt >
            Math.max(
              dtTimestampsQueue.getAverage() * 3,
              dtTimestampsQueue.getAverage() + 0.15
            )
        ) {
          if (flagSameFreeze) {
            totalFreezesDuration =
              totalFreezesDuration + (myNow - lastModifiedTFDTimestamp) / 1000;
          } else {
            totalFreezesDuration += dt;
          }
        }
        flagSameFreeze = false;
        dtTimestampsQueue.smartAppend(dt);

        fpsQueue.smartAppend(1 / dt); //фпс "за текущий кадр" (значение будет не очень точным, далее усредним)
        lastTime = Date.now();
        if (!statsInterval) {
          return;
        }
        videoElement.requestVideoFrameCallback(addFpsToList);
      };

      videoElement.requestVideoFrameCallback(addFpsToList);

      const frameContainer = document.getElementById("vttFrameContainer");
      frameContainer.style.display = "block";

      const downloadStats = () => {
        downloadFile({
          url: getDataUrl({
            data: createReportTableInCsv({
              startAt,
              peerConnection: desiredRtcPeerConnection,
              statsLog,
            }),
            mimeType: "text/csv",
          }),
          fileName: "report",
        });
      };
      window.addEventListener(CONSTS.VTT_DOWNLOAD_BUTTON_CLICK, downloadStats);

      const callback = (e: MessageEvent) => {
        if (
          [
            CONSTS.VTT_CONTEXT_BTN_CLICK,
            CONSTS.VTT_HIDE,
            CONSTS.VTT_STOP_CALCULATION,
          ].includes(e.data.id)
        ) {
          stopCalculation();
          window.removeEventListener(
            CONSTS.VTT_DOWNLOAD_BUTTON_CLICK,
            downloadStats
          );
          window.removeEventListener("message", callback, false);
        }

        if (e.data.id === CONSTS.VTT_IS_MAIN_SCREEN && e.data.value) {
          window.removeEventListener(
            CONSTS.VTT_DOWNLOAD_BUTTON_CLICK,
            downloadStats
          );
        }
      };

      window.addEventListener("message", callback, false);
    },
  });
};

export default registerContextEvents;
