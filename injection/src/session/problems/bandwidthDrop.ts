// Problem 1, Bandwidth drop (PRD §12.3, card §12.4): the bitrate fell under half of its median
// while the network showed trouble.
import { groupThousands } from "shared/format";
import { SessionEvent } from "../events";
import { Description, Detector, median, Problem, ProblemEngine } from "./engine";

// Median of the bitrate over this many seconds before the sample.
export const MEDIAN_WINDOW_S = 30;
// A median of fewer samples is not a baseline: no drop in the first seconds of a session.
export const MIN_HISTORY = 5;
// Start: bitrate < 50 % of the median, 2 samples in a row, and loss ≥ 2 % or ≥ 2 PLI in 5 s
// or the channel estimate < 50 % of its median.
export const DROP_SHARE = 0.5;
export const START_SAMPLES = 2;
export const LOSS_PCT = 2;
export const PLI_WINDOW_S = 5;
export const PLI_COUNT = 2;
// End: bitrate ≥ 80 % of the median before the start, 5 samples in a row; a layer switched up; 120 s.
export const RECOVERED_SHARE = 0.8;
export const END_SAMPLES = 5;
export const MAX_S = 120;

export interface BandwidthDropData {
  // Medians over the 30 s before the start: kbps, ms, kbps.
  before: number;
  rttBefore: number | null;
  availBefore: number | null;
}

const kbps = (value: number) => groupThousands(value);
const mbps = (kbitPerSecond: number) => (kbitPerSecond / 1000).toFixed(1);
const max = (values: number[]) => (values.length ? Math.max(...values) : null);
const min = (values: number[]) => (values.length ? Math.min(...values) : null);
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

const isDown = (e: SessionEvent) => e.to !== undefined && e.from !== undefined && e.to < e.from;
const isUp = (e: SessionEvent) => e.to !== undefined && e.from !== undefined && e.to > e.from;

// The layer the drop went down to: the height before the first switch down → the lowest one.
const layerDrop = (events: SessionEvent[]): { from: number; to: number } | null => {
  const downs = events.filter(isDown);
  if (!downs.length) {
    return null;
  }
  return { from: downs[0].from as number, to: Math.min(...downs.map((e) => e.to as number)) };
};

export class BandwidthDrop implements Detector<BandwidthDropData> {
  readonly type = "bandwidth_drop";
  // Times of the low-bitrate samples in a row, and of the recovered ones in a row.
  private low: number[] = [];
  private recovered: number[] = [];

  onSample(engine: ProblemEngine): void {
    const open = engine.current<BandwidthDropData>(this.type);
    if (open) {
      this.watchEnd(open, engine);
    } else {
      this.watchStart(engine);
    }
  }

  private watchStart(engine: ProblemEngine): void {
    const { t } = engine;
    const bitrate = engine.sample?.v_bitrate ?? null;
    const history = engine.valuesBefore("v_bitrate", t, MEDIAN_WINDOW_S);
    const baseline = median(history);
    if (bitrate === null || baseline === null || history.length < MIN_HISTORY || bitrate >= DROP_SHARE * baseline) {
      this.low = [];
      return;
    }
    this.low.push(t);
    if (this.low.length < START_SAMPLES || !this.networkTrouble(engine)) {
      return;
    }
    const tStart = this.low[0];
    engine.open<BandwidthDropData>(this.type, tStart, {
      before: engine.medianBefore("v_bitrate", tStart, MEDIAN_WINDOW_S) ?? baseline,
      rttBefore: engine.medianBefore("rtt", tStart, MEDIAN_WINDOW_S),
      availBefore: engine.medianBefore("avail_in", tStart, MEDIAN_WINDOW_S),
    });
    this.low = [];
    this.recovered = [];
  }

  private networkTrouble(engine: ProblemEngine): boolean {
    const s = engine.sample;
    if (s?.v_loss != null && s.v_loss >= LOSS_PCT) {
      return true;
    }
    if (sum(engine.recent("v_pli", PLI_WINDOW_S)) >= PLI_COUNT) {
      return true;
    }
    const availBaseline = engine.medianBefore("avail_in", engine.t, MEDIAN_WINDOW_S);
    return s?.avail_in != null && availBaseline !== null && s.avail_in < DROP_SHARE * availBaseline;
  }

  private watchEnd(open: Problem<BandwidthDropData>, engine: ProblemEngine): void {
    const { t } = engine;
    const up = engine.events.between("layer_change", open.tStart, t).find((e) => e.t > open.tStart && isUp(e));
    if (up) {
      this.end(open, up.t, engine);
      return;
    }
    if (t - open.tStart >= MAX_S) {
      this.end(open, open.tStart + MAX_S, engine);
      return;
    }
    const bitrate = engine.sample?.v_bitrate ?? null;
    if (bitrate !== null && bitrate >= RECOVERED_SHARE * open.data.before) {
      this.recovered.push(t);
    } else {
      this.recovered = [];
    }
    if (this.recovered.length >= END_SAMPLES) {
      this.end(open, this.recovered[0], engine);
    }
  }

  private end(open: Problem<BandwidthDropData>, tEnd: number, engine: ProblemEngine): void {
    engine.close(open, tEnd);
    this.low = [];
    this.recovered = [];
  }

  // The frame height of before the drop came back, s after the end; null — not yet.
  private recovery(problem: Problem<BandwidthDropData>, engine: ProblemEngine, height: number): number | null {
    if (problem.tEnd === null) {
      return null;
    }
    const back = engine.events.between("layer_change", problem.tStart, engine.t).find((e) => isUp(e) && (e.to as number) >= height);
    return back ? Math.max(0, back.t - problem.tEnd) : null;
  }

  settled(problem: Problem<BandwidthDropData>, engine: ProblemEngine): boolean {
    const layer = layerDrop(engine.events.between("layer_change", problem.tStart, problem.tEnd ?? engine.t));
    return !layer || this.recovery(problem, engine, layer.from) !== null;
  }

  describe(problem: Problem<BandwidthDropData>, engine: ProblemEngine): Description {
    const { before, rttBefore, availBefore } = problem.data;
    const end = problem.tEnd ?? engine.t;
    const lowest = min(engine.values("v_bitrate", problem.tStart, end)) ?? before;
    const maxLoss = max(engine.values("v_loss", problem.tStart, end));
    const maxRtt = max(engine.values("rtt", problem.tStart, end));
    const lowestAvail = min(engine.values("avail_in", problem.tStart, end));
    const layer = layerDrop(engine.events.between("layer_change", problem.tStart, end));
    const freezes = engine.problems.filter((p) => p.type === "video_freeze" && p.id > 0
      && p.tStart <= end && (p.tEnd ?? engine.t) >= problem.tStart).length;

    const bitrate = `${kbps(before)} → ${kbps(lowest)} kbps`;
    const loss = maxLoss === null ? "—" : `${maxLoss.toFixed(1)} %`;
    const freezePart = freezes ? `, ${freezes} ${freezes === 1 ? "freeze" : "freezes"}` : "";
    const layerPart = layer ? `, layer ${layer.from}p → ${layer.to}p` : "";

    const rows: [string, string][] = [
      ["Bitrate", bitrate],
      ["Packet loss", maxLoss === null ? "—" : `max ${loss}`],
      ["NACK / PLI", `${sum(engine.values("v_nack", problem.tStart, end))} / ${sum(engine.values("v_pli", problem.tStart, end))}`],
      ["RTT", rttBefore === null || maxRtt === null ? "—" : `${Math.round(rttBefore)} → ${Math.round(maxRtt)} ms`],
      ["Layer", layer ? `${layer.from}p → ${layer.to}p` : "unchanged"],
    ];
    if (layer) {
      const seconds = this.recovery(problem, engine, layer.from);
      rows.push(["Recovery", seconds === null ? "not yet" : `${Math.round(seconds)} s to ${layer.from}p`]);
    }

    const cause = availBefore !== null && lowestAvail !== null && lowestAvail < availBefore
      ? `channel estimate fell ${mbps(availBefore)} → ${mbps(lowestAvail)} Mbit/s`
      : `packet loss spiked to ${loss}`;

    const card: Description["card"] = {
      series: engine.cardSeries("v_bitrate", problem),
      rows,
      likelyCause: `Network between you and the sender: ${cause}.`,
      check: "Wi-Fi/VPN on this machine. If it happens to everyone at once — SFU or the sender's uplink.",
    };
    const avail = engine.cardSeries("avail_in", problem);
    if (avail.points.some(([, v]) => v !== null)) {
      card.dashed = avail;
    }

    return {
      title: "Bandwidth drop",
      category: "Network",
      severity: freezes || layer ? "severe" : "warn",
      oneLine: `bitrate ${bitrate}${freezePart}${layerPart}`,
      card,
    };
  }
}
