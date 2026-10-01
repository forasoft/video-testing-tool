// Problem 8, Audio / video out of sync (PRD §12.3, card §12.4): the audio and the video play out moments
// of the sender that are far apart. av_offset needs estimatedPlayoutTimestamp of both, and Chrome reports
// it only for an audio and a video track it keeps in sync (one stream): without it the detector is silent.
import { Description, Detector, median, Problem, ProblemEngine } from "./engine";

// Start: |av_offset| > 200 ms 3 samples in a row; end: < 120 ms 3 samples in a row.
const START_MS = 200;
export const START_SAMPLES = 3;
const END_MS = 120;
export const END_SAMPLES = 3;

const max = (values: number[]) => (values.length ? Math.max(...values) : null);
const min = (values: number[]) => (values.length ? Math.min(...values) : null);
const ms = (value: number | null) => (value === null ? "—" : String(Math.round(value)));

// Detects Audio / video out of sync: |av_offset| above START_MS for START_SAMPLES samples in a row.
export class AvSync implements Detector {
  readonly type = "av_sync";
  // Times of the samples out of sync in a row, and of the ones back in sync in a row.
  private out: number[] = [];
  private back: number[] = [];

  // Opens at the first of the samples out of sync in a row, closes at the first of those back in sync.
  onSample(engine: ProblemEngine): void {
    const offset = engine.sample?.av_offset ?? null;
    const open = engine.current(this.type);

    if (!open) {
      if (offset !== null && Math.abs(offset) > START_MS) {
        this.out.push(engine.t);
      } else {
        this.out = [];
      }
      if (this.out.length >= START_SAMPLES) {
        engine.open(this.type, this.out[0], {});
        this.out = [];
        this.back = [];
      }
      return;
    }
    // Without the playout timestamps there is nothing out of sync to show.
    if (offset === null || Math.abs(offset) < END_MS) {
      this.back.push(engine.t);
    } else {
      this.back = [];
    }
    if (this.back.length >= END_SAMPLES) {
      engine.close(open, this.back[0]);
      this.back = [];
    }
  }

  // The offset shown is its median over the problem; positive — audio ahead (its playout timestamp is later).
  describe(problem: Problem, engine: ProblemEngine): Description {
    const { tStart, tEnd } = problem;
    // The samples of the problem: up to now, or up to its end (the first sample back in sync).
    const during = (field: "av_offset" | "v_jb" | "a_jb" | "d_video") => (tEnd === null
      ? engine.values(field, tStart, engine.t)
      : engine.valuesBefore(field, tEnd, tEnd - tStart));
    const offset = median(during("av_offset")) ?? 0;
    const ahead = offset >= 0;
    const offsetText = `audio ${ahead ? "ahead" : "behind"} by ${Math.round(Math.abs(offset))} ms`;
    const videoBuffer = during("v_jb");
    const audioBuffer = during("a_jb");
    // Audio ahead: the video waited in its buffer longer, and the other way round.
    const [grown, grew, stayed] = ahead
      ? ["video", max(videoBuffer), min(audioBuffer)]
      : ["audio", max(audioBuffer), min(videoBuffer)];

    return {
      title: "Audio / video out of sync",
      category: "Device",
      severity: "warn",
      oneLine: offsetText,
      card: {
        series: engine.cardSeries("av_offset", problem),
        rows: [
          ["Offset", offsetText],
          ["Video jitter buffer / Audio jitter buffer", `${ms(median(videoBuffer))} / ${ms(median(audioBuffer))} ms`],
          ["Video delay", `${ms(median(during("d_video")))} ms`],
        ],
        likelyCause: `The ${grown} jitter buffer grew to ${ms(grew)} ms while the other stayed at ${ms(stayed)} ms.`,
        check: "If it started after a freeze or a layer change — recovers on its own; if constant — sender timestamps.",
      },
    };
  }
}
