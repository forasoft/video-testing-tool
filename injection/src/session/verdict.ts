// Verdict of the session (PRD §11.1): the worst problem decides the level; Σ — seconds with a problem.
import { mmss } from "shared/format";
import { ProblemMessage, VerdictInfo } from "shared/protocol";

// Seconds of a problem up to t while it goes on.
export const problemDuration = (problem: ProblemMessage, t: number): number =>
  (problem.tEnd ?? Math.max(t, problem.tStart)) - problem.tStart;

// By severity, then by duration; the earlier one of equals.
export const worstProblem = (problems: ProblemMessage[], t: number): ProblemMessage | null =>
  problems.reduce<ProblemMessage | null>((worst, problem) => {
    if (!worst) {
      return problem;
    }
    if (problem.severity !== worst.severity) {
      return problem.severity === "severe" ? problem : worst;
    }
    return problemDuration(problem, t) > problemDuration(worst, t) ? problem : worst;
  }, null);

// Seconds of the session with at least one problem: problems that overlap (a freeze inside a bandwidth
// drop) count once, so Σ is never longer than the session (`Degraded 32.0 s of 0:53`, PRD §12.5).
export const degradedSeconds = (problems: ProblemMessage[], t: number): number => {
  const spans = problems
    .map((p) => [p.tStart, p.tStart + problemDuration(p, t)])
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let covered = -Infinity;
  spans.forEach(([from, to]) => {
    if (to > covered) {
      total += to - Math.max(from, covered);
      covered = to;
    }
  });
  return total;
};

// The verdict as of t: OK without problems, Severe with a severe one, else Degraded; Σ rounded to 0.1 s.
export const verdict = (problems: ProblemMessage[], t: number): VerdictInfo => {
  const worst = worstProblem(problems, t);
  const total = degradedSeconds(problems, t);

  if (!worst) {
    return { level: "OK", degradedS: 0, worst: null, text: `No problems in ${mmss(t)}` };
  }
  return {
    level: problems.some((p) => p.severity === "severe") ? "Severe" : "Degraded",
    degradedS: Math.round(total * 10) / 10,
    worst: worst.id,
    text: `Worst: ${worst.title} at ${mmss(worst.tStart)} — ${worst.oneLine}`,
  };
};
