// Sparklines of the Compact tiles: the last 120 s of each tile's value (PRD §9.2).
import { SampleField } from "shared/constants/sampleFields";
import { SparklineKey, Sparklines } from "shared/protocol";
import { SampleBuffer } from "./buffer";

export const SPARKLINE_LENGTH = 120;

// Sample field behind each tile; Resolution is drawn by the frame height.
export const SPARKLINE_FIELDS: Record<SparklineKey, SampleField> = {
  fps: "v_fps_r",
  videoDelay: "d_video",
  audioDelay: "d_audio",
  loss: "v_loss",
  resolution: "v_h",
  freezes: "v_freeze_pct",
  bitrate: "v_bitrate",
};

// Always SPARKLINE_LENGTH values: a young session is padded with null on the left,
// so that one value is one second at a fixed place on the x axis.
export const sparklines = (buffer: SampleBuffer): Sparklines => {
  const result = {} as Sparklines;
  (Object.keys(SPARKLINE_FIELDS) as SparklineKey[]).forEach((key) => {
    const values = buffer.lastN(SPARKLINE_FIELDS[key], SPARKLINE_LENGTH);
    result[key] = [...new Array(SPARKLINE_LENGTH - values.length).fill(null), ...values];
  });
  return result;
};
