// Status row of Compact (PRD §9.1): is there a problem now, were there any, is the stream gone.
import { mmss } from "shared/format";
import { ProblemMessage, SessionState, StatusInfo } from "shared/protocol";
import { worstProblem } from "./verdict";

// The first seconds of a session: too little data to judge.
export const COLLECTING_S = 5;

// A problem going on now outranks "Collecting data…": a reconnection in the first seconds is news.
export const sessionStatus = (problems: ProblemMessage[], t: number, state: SessionState): StatusInfo => {
  const time = mmss(t);

  if (state === "disconnected") {
    return { kind: "disconnected", text: `Stream disconnected · ${time}`, time };
  }

  const now = worstProblem(problems.filter((p) => p.open), t);
  if (now) {
    return { kind: "now", text: `${now.title} · now`, time, severity: now.severity };
  }

  if (t < COLLECTING_S) {
    return { kind: "collecting", text: "Collecting data…", time };
  }

  const worst = worstProblem(problems, t);
  if (worst) {
    const lastEnd = Math.max(...problems.map((p) => p.tEnd ?? t));
    const n = problems.length;
    const ago = Math.max(0, Math.round(t - lastEnd));
    return {
      kind: "past",
      text: `${n} ${n === 1 ? "problem" : "problems"} · last ${ago}s ago`,
      time,
      severity: worst.severity,
    };
  }

  return { kind: "ok", text: `No problems · ${time}`, time };
};
