// Problem 9, Blurry picture (PRD §12.3, card §12.4): the sender encodes the picture coarsely — QP in the
// bad zone of its codec (§7) — while the bitrate has not fallen: too few bits for the resolution.
import { VIDEO_CODECS } from "shared/constants/sampleFields";
import { groupThousands } from "shared/format";
import { qpGoodness, qpThresholds } from "../goodness";
import { Description, Detector, median, Problem, ProblemEngine } from "./engine";

// Start: QP bad and bitrate ≥ 80 % of its median over the 30 s before, 5 samples in a row, and no Bandwidth
// drop going on — a lower bitrate is a Bandwidth drop, and a long one pulls the median down with it; end: QP
// not bad 5 samples in a row.
export const START_SAMPLES = 5;
export const END_SAMPLES = 5;
export const MEDIAN_WINDOW_S = 30;
export const BITRATE_SHARE = 0.8;

const kbps = (value: number | null) => (value === null ? "—" : groupThousands(value));
const round = (value: number | null) => (value === null ? "—" : String(Math.round(value)));
// The lower middle value: an existing frame size, not the mean of two.
const lowerMedian = (values: number[]) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] : null);

const codecOf = (id: number | null | undefined): string | null => (id === null || id === undefined ? null : VIDEO_CODECS[id] ?? null);

export class Blurry implements Detector {
  readonly type = "blurry";
  // Times of the blurry samples in a row, and of the sharp ones in a row.
  private blurry: number[] = [];
  private sharp: number[] = [];

  onSample(engine: ProblemEngine): void {
    const s = engine.sample;
    const codec = codecOf(s?.v_codec_id);
    const bad = s?.v_qp != null && codec !== null && qpGoodness(s.v_qp, codec) === "bad";
    const open = engine.current(this.type);

    if (!open) {
      if (bad && this.bitrateHolds(engine) && !engine.current("bandwidth_drop")) {
        this.blurry.push(engine.t);
      } else {
        this.blurry = [];
      }
      if (this.blurry.length >= START_SAMPLES) {
        engine.open(this.type, this.blurry[0], {});
        this.blurry = [];
        this.sharp = [];
      }
      return;
    }
    if (bad) {
      this.sharp = [];
    } else {
      this.sharp.push(engine.t);
    }
    if (this.sharp.length >= END_SAMPLES) {
      engine.close(open, this.sharp[0]);
      this.sharp = [];
    }
  }

  // The bitrate is at least 80 % of its median over the 30 s before; nothing to compare with yet — it holds.
  private bitrateHolds(engine: ProblemEngine): boolean {
    const bitrate = engine.sample?.v_bitrate ?? null;
    const baseline = median(engine.valuesBefore("v_bitrate", engine.t, MEDIAN_WINDOW_S));
    return bitrate !== null && (baseline === null || bitrate >= BITRATE_SHARE * baseline);
  }

  describe(problem: Problem, engine: ProblemEngine): Description {
    const { tStart, tEnd } = problem;
    // The samples of the problem: up to now, or up to its end (the first sharp sample).
    const during = (field: "v_qp" | "v_bitrate" | "v_w" | "v_h" | "v_codec_id") => (tEnd === null
      ? engine.values(field, tStart, engine.t)
      : engine.valuesBefore(field, tEnd, tEnd - tStart));
    const qp = median(during("v_qp"));
    const bitrate = median(during("v_bitrate"));
    const w = lowerMedian(during("v_w"));
    const h = lowerMedian(during("v_h"));
    const codec = codecOf(during("v_codec_id").pop());
    const threshold = codec === null ? undefined : qpThresholds(codec)?.[1];
    const size = w !== null && h !== null ? `${w}×${h}` : "—";

    return {
      title: "Blurry picture",
      category: "Sender",
      severity: "warn",
      oneLine: `QP ${round(qp)} at ${round(h)}p, bitrate ${kbps(bitrate)} kbps`,
      card: {
        series: engine.cardSeries("v_qp", problem),
        rows: [
          ["QP", `${round(qp)} (${codec ?? "—"}, bad above ${threshold ?? "—"})`],
          ["Bitrate", `${kbps(bitrate)} kbps at ${size}`],
          ["Layer", `${round(h)}p`],
        ],
        likelyCause: `The sender encodes ${size} at only ${kbps(bitrate)} kbps — too little for this resolution.`,
        check: "Sender's encoder settings or SFU layer selection; the network is fine.",
      },
    };
  }
}
