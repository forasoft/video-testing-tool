// Problem 7, Audio stutter (PRD §12.3, card §12.4): the audio decoder had to make up samples because
// packets came late or not at all.
import { Description, Detector, Problem, ProblemEngine } from "./engine";

// Start: concealed samples over the 5-s window (a_concealed_pct) above 5 %; end: below 2 % five samples in a
// row; severe when the peak is above 20 %.
const START_PCT = 5;
const END_PCT = 2;
export const END_SAMPLES = 5;
const SEVERE_PCT = 20;

const max = (values: number[]) => (values.length ? Math.max(...values) : null);
const pct = (value: number | null) => (value === null ? "—" : `${value.toFixed(1)} %`);
const ms = (value: number | null) => (value === null ? "—" : `${Math.round(value)} ms`);

// Detects Audio stutter from a_concealed_pct, the share of concealed audio samples over the last 5 s.
export class AudioStutter implements Detector {
  readonly type = "audio_stutter";
  // Times of the calm samples in a row while a stutter goes on.
  private calm: number[] = [];

  // One sample above START_PCT opens a stutter (the field is a 5-s window already); END_SAMPLES calm ones close it.
  onSample(engine: ProblemEngine): void {
    const concealed = engine.sample?.a_concealed_pct ?? null;
    const open = engine.current(this.type);

    if (!open) {
      if (concealed !== null && concealed > START_PCT) {
        engine.open(this.type, engine.t, {});
        this.calm = [];
      }
      return;
    }
    // No audio counters at all is no stutter either.
    if (concealed === null || concealed < END_PCT) {
      this.calm.push(engine.t);
    } else {
      this.calm = [];
    }
    if (this.calm.length >= END_SAMPLES) {
      engine.close(open, this.calm[0]);
      this.calm = [];
    }
  }

  // Severe when the concealed share peaked above SEVERE_PCT; the rows are the peaks over the problem.
  describe(problem: Problem, engine: ProblemEngine): Description {
    const end = problem.tEnd ?? engine.t;
    const peak = max(engine.values("a_concealed_pct", problem.tStart, end));
    const loss = max(engine.values("a_loss", problem.tStart, end));
    const jitter = max(engine.values("a_jitter", problem.tStart, end));
    const buffer = max(engine.values("a_jb", problem.tStart, end));

    return {
      title: "Audio stutter",
      category: "Network",
      severity: peak !== null && peak > SEVERE_PCT ? "severe" : "warn",
      oneLine: `${pct(peak)} concealed`,
      card: {
        series: engine.cardSeries("a_concealed_pct", problem),
        rows: [
          ["Concealed", `peak ${pct(peak)}`],
          ["Audio packet loss", pct(loss)],
          ["Audio jitter", ms(jitter)],
          ["Audio jitter buffer", ms(buffer)],
        ],
        likelyCause: `Audio packets arrived late or not at all: loss ${pct(loss)}, jitter ${ms(jitter)}.`,
        check: "Same network checks as Bandwidth drop; if video was fine at the same time — audio-only path or sender microphone pipeline.",
      },
    };
  }
}
