import React, { useContext } from "react";
import styles from "./index.module.css";
import { StreamInfoContext } from "../../context/StreamInfoContext";
import { DisplayContext } from "../../context/DisplayContext";
import { Properties, StateData } from "../../types/State";
import { HintContainer } from "../icons/HintContainer";
import { FpsIcon } from "../icons/statIcons/FpsIcon";
import { FreezesDurationIcon } from "../icons/statIcons/FreezesDuration";
import { ResolutionIcon } from "../icons/statIcons/Resolution";
import { PacketLossIcon } from "../icons/statIcons/PacketLoss";
import { AudioDelayIcon } from "../icons/statIcons/AudioDelay";
import { VideoDelayIcon } from "../icons/statIcons/VideoDelay";
import { useTranslation } from "../../context/TranslationContext";
import { NoValueTextContainer } from "../icons/NoValueContainer";
import { BitrateIcon } from "../icons/statIcons/Bitrate";
import { Disconnect } from "../icons/statIcons/Disconnect";

type IParams = {
  [key in Properties]: {
    renderIcon: () => React.ReactNode,
    errorValue?: string,
    hiddenValue?: string,
  };
};

const params: IParams = {
  averageFps: {
    renderIcon: () => <FpsIcon />,
  },
  videoDelay: {
    renderIcon: () => <VideoDelayIcon />,
    errorValue: "0.0 ms",
  },
  audioDelay: {
    renderIcon: () => <AudioDelayIcon />,
    errorValue: "0.0 ms",
  },
  packetLoss: {
    renderIcon: () => <PacketLossIcon />,
  },
  resolution: {
    renderIcon: () => <ResolutionIcon />,
  },
  freezesDuration: {
    renderIcon: () => <FreezesDurationIcon />,
  },
  bitrate: {
    renderIcon: () => <BitrateIcon />,
  },
};

const StreamInfo: React.FC = () => {
  const t = useTranslation();
  const state = useContext(StreamInfoContext);
  const { state: { fullSize } } = useContext(DisplayContext);

  if (state.disconnect) {
    return (
      <div className={styles.wrapperDisconnectScreen}>
        <Disconnect />
        <span className={styles.disconnectTitle}>This stream was disconnected</span>
        <span className={styles.disconnectText}>Please select another one</span>
      </div>
    );
  }

  return (
    <>
      {Object.values(Properties).map((key) => (
        state[key] as StateData).value !== params[key].hiddenValue && (
        <div className={styles.wrapper} key={key}>
          <div className={styles.stat}>
            <div className={styles.leftSide}>
              {params[key].renderIcon()}

              {fullSize && (
                <>
                  <span className={styles.text}>
                    {t(`stats.${key}.label`)}
                  </span>

                  <HintContainer
                    key={`${key}.hintText`}
                    hintText={t(`stats.${key}.hintText`)}
                  />
                </>
              )}
            </div>
            <div>
              <div className={`${styles.rightSide} ${styles[(state[key] as StateData).goodness]}`}>
                {(state[key] as StateData).value !== params[key].errorValue
                  ? (state[key] as StateData).value
                  : <NoValueTextContainer errorText={t(`stats.${key}.errorText`)} />}
              </div>
            </div>
          </div>
        </div>
      ))}

      <div className={styles.codecsWrapper}>
        <div className={styles.codec}>
          {fullSize && (
            <span className={styles.secondaryText}>
              {t("stats.audioCodec.label")}
              :
            </span>
          )}

          {state.audioCodec ? (
            <span className={styles.text}>{state.audioCodec}</span>
          ) : (
            <NoValueTextContainer errorText={t("stats.audioCodec.errorText")} />
          )}
        </div>

        <div className={styles.codec}>
          {fullSize && (
            <span className={styles.secondaryText}>
              {t("stats.videoCodec.label")}
              :
            </span>
          )}

          {state.videoCodec ? (
            <span className={styles.text}>{state.videoCodec}</span>
          ) : (
            <NoValueTextContainer errorText={t("stats.videoCodec.errorText")} />
          )}
        </div>
      </div>
    </>
  );
};

export default StreamInfo;
