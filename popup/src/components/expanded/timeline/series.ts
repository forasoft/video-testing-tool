// Chart series from the samples the popup keeps (PRD §11.2).
import { SampleField, SampleValues } from "../../../../../shared/constants/sampleFields";
import { Point } from "./scale";

// One field of the samples as a series; a null is a gap in its line.
export const pointsOf = (samples: SampleValues[], field: SampleField): Point[] =>
  samples.map((s) => ({ t: s.t as number, v: s[field] }));

// Tops of the delay stack layers, from the bottom: the network (rtt / 2), + the jitter buffer,
// + decode and render — the top is the video delay. A second without video delay is a gap.
interface DelayStack {
  net: Point[];
  buffer: Point[];
  total: Point[];
}

// A layer the browser does not report counts as 0; a second without video delay is a gap in every layer.
export const delayStack = (samples: SampleValues[]): DelayStack => {
  const stack: DelayStack = { net: [], buffer: [], total: [] };
  samples.forEach((s) => {
    const t = s.t as number;
    const net = s.d_video === null ? null : s.d_net ?? 0;
    stack.net.push({ t, v: net });
    stack.buffer.push({ t, v: net === null ? null : net + (s.d_jb ?? 0) });
    stack.total.push({ t, v: s.d_video });
  });
  return stack;
};
