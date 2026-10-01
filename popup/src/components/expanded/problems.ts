// Problems as the Timeline and Report show them (PRD §11.2, §11.4, §12.2): intervals, durations,
// the problem under a point of the timeline.
import { mmss } from "../../../../shared/format";
import { ProblemMessage } from "../../../../shared/protocol";

// A problem that goes on ends now.
export const problemEnd = (problem: ProblemMessage, now: number): number => problem.tEnd ?? Math.max(now, problem.tStart);

// `0:38–0:48`; `1:02` for a problem shorter than 1 s; `0:38–now` while it goes on.
export const problemInterval = (problem: ProblemMessage): string => {
  const start = mmss(problem.tStart);
  if (problem.tEnd === null) {
    return `${start}–now`;
  }
  return problem.tEnd - problem.tStart < 1 ? start : `${start}–${mmss(problem.tEnd)}`;
};

// `9.7 s`
export const problemDuration = (problem: ProblemMessage, now: number): string =>
  `${(problemEnd(problem, now) - problem.tStart).toFixed(1)} s`;

// The problems whose band holds t; the shortest first, as it is drawn on top.
export const problemsAt = (problems: ProblemMessage[], t: number, now: number): ProblemMessage[] => problems
  .filter((p) => p.tStart <= t && t <= problemEnd(p, now))
  .sort((a, b) => (problemEnd(a, now) - a.tStart) - (problemEnd(b, now) - b.tStart));
