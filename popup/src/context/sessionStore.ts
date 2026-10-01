// Events and problems of the session as the popup keeps them: from their own messages (VTT_EVENT,
// VTT_PROBLEM) and from history answers (VTT_HISTORY), with the limits of PRD §6.4.
import { SampleValues } from "../../../shared/constants/sampleFields";
import {
  EventMessage, ProblemMessage, ReportMessage, SampleMessage, SessionMessage, StreamRow
} from "../../../shared/protocol";

// Everything the panel shows comes from injection messages; nothing is computed here. Frame rate of VTT_FPS is kept
// apart (FpsContext): it comes four times a second and must not draw the whole panel again.
export interface SessionState {
  session: SessionMessage | null;
  sample: SampleMessage | null;
  // Values of the latest samples, oldest first.
  history: SampleValues[];
  // Events of the session (VTT_EVENT and history answers), by number.
  events: EventMessage[];
  // Problems of the session (VTT_PROBLEM and history answers), by id.
  problems: ProblemMessage[];
  // The latest answer to VTT_GET_REPORT: what the Report shows besides the sample and the problems.
  report: ReportMessage | null;
  // Other streams on this page (VTT_STREAMS, every 5 s); empty when there are none.
  streams: StreamRow[];
}

// Events kept at most, as in the injection (PRD §6.4).
export const EVENT_LIMIT = 2000;
// Problems kept at most, as in the injection (PRD §6.4).
export const PROBLEM_LIMIT = 200;

// Events by number; beyond the limit the oldest ones go, marks stay.
export const addEvents = (events: EventMessage[], incoming: EventMessage[]): EventMessage[] => {
  const known = new Set(events.map((e) => e.n));
  const added = incoming.filter((e) => !known.has(e.n));
  if (!added.length) {
    return events;
  }
  const all = [...events, ...added].sort((a, b) => a.n - b.n);
  let extra = all.length - EVENT_LIMIT;
  return extra > 0
    ? all.filter((e) => {
      if (extra > 0 && e.kind !== "mark") {
        extra -= 1;
        return false;
      }
      return true;
    })
    : all;
};

// Problems by id: a message replaces the problem's previous one, a history answer only adds the
// problems the popup did not get (its own messages are newer). Beyond the limit the oldest
// ended problems go.
export const addProblems = (problems: ProblemMessage[], incoming: ProblemMessage[], replace: boolean): ProblemMessage[] => {
  const byId = new Map(problems.map((p) => [p.id, p]));
  let changed = false;
  for (const p of incoming) {
    if (replace || !byId.has(p.id)) {
      byId.set(p.id, p);
      changed = true;
    }
  }
  if (!changed) {
    return problems;
  }
  const all = [...byId.values()].sort((a, b) => a.id - b.id);
  let extra = all.length - PROBLEM_LIMIT;
  return extra > 0
    ? all.filter((p) => {
      if (extra > 0 && p.tEnd !== null) {
        extra -= 1;
        return false;
      }
      return true;
    })
    : all;
};
