// Problem 6, Your upload limited by CPU / bandwidth (PRD §12.3, card §12.4): the browser lowered the
// quality of this page's own outgoing video because the encoder or the uplink could not keep up.
import { QUALITY_LIMITS } from "shared/constants/sampleFields";
import { groupThousands } from "shared/format";
import { Snapshot } from "../extract";
import { topLayer } from "../metrics";
import { Description, Detector, median, Problem, ProblemEngine } from "./engine";

// Start: out_limit cpu or bandwidth 3 samples in a row; end: none 3 samples in a row.
export const START_SAMPLES = 3;
export const END_SAMPLES = 3;
// "Requested" — the encoder's target before the start: its median over 30 s, of at least 5 samples.
export const MEDIAN_WINDOW_S = 30;
export const MIN_HISTORY = 5;

type Reason = "cpu" | "bandwidth";

const CPU = QUALITY_LIMITS.indexOf("cpu");
const BANDWIDTH = QUALITY_LIMITS.indexOf("bandwidth");
const NONE = QUALITY_LIMITS.indexOf("none");

const TITLES: Record<Reason, string> = {
  cpu: "Your upload limited by CPU",
  bandwidth: "Your upload limited by bandwidth",
};

// The outgoing video of the latest getStats(): its encoder and the size it is captured at.
export interface SenderInfo {
  encoder: string | null;
  width: number | null;
  height: number | null;
}

export interface UploadLimitedData extends SenderInfo {
  // The reason of the start: it decides a tie between cpu and bandwidth seconds.
  first: Reason;
  // Median out_target of the 30 s before the start, kbps; null without enough history.
  targetBefore: number | null;
}

const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);
const count = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

export const senderInfo = (snapshot: Snapshot | null): SenderInfo => {
  const layers = snapshot?.outbound ?? [];
  const source = snapshot?.outboundSource;
  return {
    encoder: text(topLayer(layers)?.encoderImplementation) ?? layers.map((layer) => text(layer.encoderImplementation)).find((name) => name !== null) ?? null,
    width: count(source?.width),
    height: count(source?.height),
  };
};

const kbps = (value: number | null) => (value === null ? "—" : groupThousands(value));
const max = (values: number[]) => (values.length ? Math.max(...values) : null);
// The lower middle value: an existing frame size, not the mean of two.
const lowerMedian = (values: number[]) => (values.length ? [...values].sort((a, b) => a - b)[Math.floor((values.length - 1) / 2)] : null);

export class UploadLimited implements Detector<UploadLimitedData> {
  readonly type = "upload_limited";
  private readonly sender: () => SenderInfo;
  // Times of the limited samples in a row, and of the free ones in a row.
  private limited: number[] = [];
  private free: number[] = [];

  // `sender` — the outgoing video of the latest getStats().
  constructor(sender: () => SenderInfo) {
    this.sender = sender;
  }

  onSample(engine: ProblemEngine): void {
    const { t } = engine;
    const limit = engine.sample?.out_limit ?? null;
    const open = engine.current<UploadLimitedData>(this.type);

    if (!open) {
      if (limit === CPU || limit === BANDWIDTH) {
        this.limited.push(t);
      } else {
        this.limited = [];
      }
      if (this.limited.length >= START_SAMPLES) {
        const tStart = this.limited[0];
        const history = engine.valuesBefore("out_target", tStart, MEDIAN_WINDOW_S);
        const first = engine.values("out_limit", tStart, tStart)[0] === CPU ? "cpu" : "bandwidth";
        engine.open<UploadLimitedData>(this.type, tStart, {
          first,
          targetBefore: history.length >= MIN_HISTORY ? median(history) : null,
          ...this.sender(),
        });
        this.limited = [];
        this.free = [];
      }
      return;
    }

    // What the sender looks like while it is limited.
    const sender = this.sender();
    open.data.encoder = sender.encoder ?? open.data.encoder;
    open.data.width = sender.width ?? open.data.width;
    open.data.height = sender.height ?? open.data.height;

    // No outgoing video any more counts as not limited; "other" is neither.
    if (limit === NONE || limit === null) {
      this.free.push(t);
    } else {
      this.free = [];
    }
    if (this.free.length >= END_SAMPLES) {
      engine.close(open, this.free[0]);
      this.free = [];
    }
  }

  describe(problem: Problem<UploadLimitedData>, engine: ProblemEngine): Description {
    const { tStart, tEnd, data } = problem;
    // The samples of the problem: up to now, or up to its end (the first sample that is not limited).
    const during = (field: "out_limit" | "out_bitrate" | "out_target" | "out_w" | "out_h" | "out_fps") => (tEnd === null
      ? engine.values(field, tStart, engine.t)
      : engine.valuesBefore(field, tEnd, tEnd - tStart));
    const limits = during("out_limit");
    const cpu = limits.filter((v) => v === CPU).length;
    const bandwidth = limits.filter((v) => v === BANDWIDTH).length;
    let reason: Reason = data.first;
    if (cpu !== bandwidth) {
      reason = cpu > bandwidth ? "cpu" : "bandwidth";
    }

    const actual = median(during("out_bitrate"));
    const target = data.targetBefore ?? max(during("out_target"));
    const w = lowerMedian(during("out_w"));
    const h = lowerMedian(during("out_h"));
    const fps = median(during("out_fps"));
    const sentSize = w !== null && h !== null ? `${w}×${h}` : null;
    const sent = sentSize === null ? "—" : `${sentSize}${fps === null ? "" : ` @ ${Math.round(fps)} fps`}`;
    // The size the encoder could not keep up with: the captured one, else the one sent.
    const size = data.width !== null && data.height !== null ? `${data.width}×${data.height}` : sentSize ?? "—";
    const encoder = data.encoder ? ` (${data.encoder})` : "";

    const texts: Record<Reason, [string, string]> = {
      cpu: [
        `This machine cannot encode ${size} in real time${encoder}.`,
        "Close other apps; lower the capture resolution; check that hardware encoding is used.",
      ],
      bandwidth: [
        `Your uplink cannot carry ${kbps(target)} kbps.`,
        "Uplink speed on this machine; other uploads running?",
      ],
    };
    const [likelyCause, check] = texts[reason];

    const card: Description["card"] = {
      series: engine.cardSeries("out_bitrate", problem),
      rows: [
        ["Reason", reason],
        ["Sent / requested", `${kbps(actual)} / ${kbps(target)} kbps`],
        ["Sent resolution", sent],
        ["Encoder", data.encoder ?? "—"],
      ],
      likelyCause,
      check,
    };
    const targetSeries = engine.cardSeries("out_target", problem);
    if (targetSeries.points.some(([, v]) => v !== null)) {
      card.dashed = targetSeries;
    }

    return {
      title: TITLES[reason],
      category: "Sender",
      severity: "warn",
      oneLine: `${reason}, ${Math.round(engine.duration(problem))} s, ${kbps(actual)} of ${kbps(target)} kbps`,
      card,
    };
  }
}
