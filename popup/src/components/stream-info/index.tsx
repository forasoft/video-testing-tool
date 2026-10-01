import React, { useContext } from "react";
import styles from "./index.module.css";
import { SessionContext } from "../../context/SessionContext";
import { DisplayContext } from "../../context/DisplayContext";
import { FpsContext } from "../../context/FpsContext";
import { SampleMessage, SparklineKey } from "../../../../shared/protocol";
import { HintContainer } from "../icons/HintContainer";
import { FpsIcon } from "../icons/statIcons/FpsIcon";
import { FreezesDurationIcon } from "../icons/statIcons/FreezesDuration";
import { ResolutionIcon } from "../icons/statIcons/Resolution";
import { PacketLossIcon } from "../icons/statIcons/PacketLoss";
import { AudioDelayIcon } from "../icons/statIcons/AudioDelay";
import { VideoDelayIcon } from "../icons/statIcons/VideoDelay";
import { useTranslation } from "../../context/TranslationContext";
import { NoValueTextContainer, NoValueTile } from "../icons/NoValueContainer";
import { BitrateIcon } from "../icons/statIcons/Bitrate";
import {
  audioDelayView, bitrateView, fpsView, freezesView, lossView, MetricView, resolutionView, videoDelayView, ViewSource
} from "../../utils/views";
import { Sparkline } from "../compact/Sparkline";
import { ConnectionChip } from "../compact/ConnectionChip";
import { StatusRow } from "../compact/StatusRow";
import { useViewPerf } from "../../utils/perf";

interface Tile {
  // Also the key of the tile's strings in translations.
  key: string;
  sparkline: SparklineKey;
  icon: React.ReactNode;
  view: (source: ViewSource) => MetricView;
  // Drawn again on VTT_FPS alone, four times a second: Frame rate, and Freezes & Stalls, which shows `—` while no
  // frames are counted (PRD §14.4).
  fps?: boolean;
}

// Seven tiles in the existing order (PRD §9.2); values and colors come from VTT_SAMPLE / VTT_FPS.
const tiles: Tile[] = [
  {
    key: "averageFps", sparkline: "fps", icon: <FpsIcon />, view: fpsView, fps: true,
  },
  {
    key: "videoDelay", sparkline: "videoDelay", icon: <VideoDelayIcon />, view: videoDelayView,
  },
  {
    key: "audioDelay", sparkline: "audioDelay", icon: <AudioDelayIcon />, view: audioDelayView,
  },
  {
    key: "packetLoss", sparkline: "loss", icon: <PacketLossIcon />, view: lossView,
  },
  {
    key: "resolution", sparkline: "resolution", icon: <ResolutionIcon />, view: resolutionView,
  },
  {
    key: "freezesDuration", sparkline: "freezes", icon: <FreezesDurationIcon />, view: freezesView, fps: true,
  },
  {
    key: "bitrate", sparkline: "bitrate", icon: <BitrateIcon />, view: bitrateView,
  },
];

interface TileProps {
  tile: Tile;
  sample: SampleMessage | null;
  fullSize: boolean;
}

// A tile, PRD §9.2: the icon, the label with its hint, the sparkline and the value in its goodness color.
const TileRow: React.FC<TileProps & { view: MetricView }> = ({
  tile: { key, sparkline, icon }, sample, fullSize, view: { value, goodness, suspended },
}) => {
  const t = useTranslation();
  const line = sample?.sparklines?.[sparkline];

  return (
    <div className={styles.wrapper} data-metric={key}>
      <div className={styles.stat}>
        <div className={styles.leftSide}>
          {icon}

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
        {fullSize && line && <Sparkline values={line} goodness={goodness} />}
        <div className={styles.valueSide}>
          {value !== null ? (
            <div className={`${styles.rightSide} ${goodness ? styles[goodness] : ""}`} data-value>
              {value}
            </div>
          ) : (
            // A hidden tab or a paused video says why there is nothing to show (PRD §14.4).
            <NoValueTile errorText={t(suspended ? `stats.suspended.${suspended}` : `stats.${key}.errorText`)} />
          )}
        </div>
      </div>
    </div>
  );
};

// The tiles that read VTT_FPS: only they are drawn again four times a second.
const FpsTile: React.FC<TileProps> = (props) => {
  const fps = useContext(FpsContext);
  const { tile, sample } = props;
  return <TileRow {...props} view={tile.view({ sample, fps })} />;
};

const StreamInfo: React.FC = () => {
  useViewPerf("tiles");
  const t = useTranslation();
  const state = useContext(SessionContext);
  const { state: { mode }, setMode } = useContext(DisplayContext);
  const fullSize = mode !== "mini";
  const { sample } = state;
  const connection = sample?.connection;

  // A disconnected stream keeps its last values; the status row says it is gone (PRD §14.3).
  // The status row opens the report, the connection chip the timeline (PRD §9.1, §9.3).
  return (
    <>
      <StatusRow status={sample?.status} mini={!fullSize} onClick={() => setMode("expanded", "report")} />

      {tiles.map((tile) => (tile.fps
        ? <FpsTile key={tile.key} tile={tile} sample={sample} fullSize={fullSize} />
        : <TileRow key={tile.key} tile={tile} sample={sample} fullSize={fullSize} view={tile.view({ sample, fps: null })} />
      ))}

      <div className={styles.codecsWrapper}>
        <div className={styles.codecs}>
          <div className={styles.codec}>
            {fullSize && (
              <span className={styles.secondaryText}>
                {t("stats.audioCodec.label")}
                :
              </span>
            )}

            {connection?.audioCodec ? (
              <span className={styles.text} data-codec="audio">{connection.audioCodec}</span>
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

            {connection?.videoCodec ? (
              <span className={styles.text} data-codec="video">{connection.videoCodec}</span>
            ) : (
              <NoValueTextContainer errorText={t("stats.videoCodec.errorText")} />
            )}
          </div>
        </div>

        {fullSize && <ConnectionChip connection={connection} onClick={() => setMode("expanded", "timeline")} />}
      </div>
    </>
  );
};

export default StreamInfo;
