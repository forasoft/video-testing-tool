import React, { FC, useState, useEffect } from "react";
import { CONST } from "../CONST/const";
import { StateTypes } from "../types/State";
import { freezesDurationHandler } from "../utils/StatsHandlers/freezDuration";
import { fpsHandler } from "../utils/StatsHandlers/fpsHandler";
import { videoDelayHandler } from "../utils/StatsHandlers/videoDelay";
import { audioDelayHandler } from "../utils/StatsHandlers/audioDelay";
import { packetLossHandler } from "../utils/StatsHandlers/packetLoss";
import { resolutionHandler } from "../utils/StatsHandlers/resolution";
import { bitrateHandler } from "../utils/StatsHandlers/bitrate";

export const StreamInfoContext = React.createContext({} as StateTypes);

interface Props {
  children: any;
}

export const StreamInfoContextProvider: FC<Props> = ({ children }) => {
  const [averageFps, setAverageFps] = useState(-1);
  const [videoDelay, setVideoDelay] = useState(-1);
  const [audioDelay, setAudioDelay] = useState(-1);
  const [packetLoss, setPacketLoss] = useState(0);
  const [height, setHeight] = useState({ value: -1, upperBound: -1 });
  const [width, setWidth] = useState({ value: -1, upperBound: -1 });
  const [freezesDuration, setFreezesDuration] = useState(0);
  const [videoCodec, setVideoCodec] = useState<Set<string>>(new Set());
  const [audioCodec, setAudioCodec] = useState<Set<string>>(new Set());
  const [bitrate, setBitrate] = useState(0);
  const [disconnect, setDisconnect] = useState(false);

  useEffect(() => {
    const callback = (e: MessageEvent) => {
      if (e.data.id === CONST.PROVIDE_FPS) {
        setAverageFps(e.data.data.fps);
        return;
      }
      if (e.data.id === CONST.PROVIDE_VIDEO_DELAY) {
        setVideoDelay(e.data.data.delay);
        return;
      }
      if (e.data.id === CONST.PROVIDE_AUDIO_DELAY) {
        setAudioDelay(e.data.data.delay);
        return;
      }
      if (e.data.id === CONST.PROVIDE_PACKET_LOSS) {
        setPacketLoss(e.data.data.packetLoss);
        return;
      }
      if (e.data.id === CONST.PROVIDE_RESOLUTION) {
        setWidth({
          value: e.data.data.width,
          upperBound: e.data.data.elementWidth / 1.2,
        });
        setHeight({
          value: e.data.data.height,
          upperBound: e.data.data.elementHeight / 1.2,
        });
        return;
      }
      if (e.data.id === CONST.PROVIDE_FREEZES) {
        setFreezesDuration(e.data.data.freezesDuration);
      }
      if (e.data.id === CONST.PROVIDE_CDECS) {
        const { video, audio } = e.data.data.codecs;
        setVideoCodec(video);
        setAudioCodec(audio);
      }
      if (e.data.id === CONST.PROVIDE_BITRATE) {
        setBitrate(e.data.data.bitrate);
      }
      if (e.data.id === CONST.ERROR_GET_STATS) {
        setDisconnect(true);
      }
      if (e.data.id === CONST.CONTEXT_MENU_VTT_WAS_CLICKED) {
        setDisconnect(false);
      }
    };

    window.addEventListener("message", callback);

    return () => {
      window.removeEventListener("message", callback);
    };
  }, []);

  const state = {
    averageFps: fpsHandler(averageFps),
    videoDelay: videoDelayHandler({ videoDelay, audioDelay }),
    audioDelay: audioDelayHandler({ audioDelay, videoDelay }),
    packetLoss: packetLossHandler(packetLoss),
    resolution: resolutionHandler(
      width.value,
      height.value,
      width.upperBound,
      height.upperBound
    ),
    freezesDuration: freezesDurationHandler(freezesDuration),
    videoCodec: Array.from(videoCodec).join(", "),
    audioCodec: Array.from(audioCodec).join(", "),
    bitrate: bitrateHandler({ bitrate, height: height.value }),
    disconnect,
  };

  return (
    <StreamInfoContext.Provider value={state}>
      {children}
    </StreamInfoContext.Provider>
  );
};
