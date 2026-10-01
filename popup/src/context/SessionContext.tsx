// The panel's state of the session, built from the injection's VTT_* messages (PRD §21): the popup computes
// nothing, it keeps what it was sent and draws it.
import React, {
  FC, useEffect, useReducer
} from "react";
import { CONST } from "../CONST/const";
import {
  EventMessage, HistoryMessage, MESSAGES, ProblemMessage, ReportMessage, SampleMessage, SessionMessage,
  StreamsMessage,
} from "../../../shared/protocol";
import { onPageMessage } from "../utils/page";
import { addEvents, addProblems, SessionState } from "./sessionStore";


// Seconds of samples the popup keeps for the timeline's last 2 minutes (PRD §11.1), with a margin.
const HISTORY_LENGTH = 125;

const initialState: SessionState = {
  session: null,
  sample: null,
  history: [],
  events: [],
  problems: [],
  report: null,
  streams: [],
};

// The state of the latest session, for every component of the panel.
export const SessionContext = React.createContext<SessionState>(initialState);

type Action =
  | { type: "SESSION"; session: SessionMessage }
  | { type: "SAMPLE"; sample: SampleMessage }
  | { type: "EVENT"; event: EventMessage }
  | { type: "PROBLEM"; problem: ProblemMessage }
  | { type: "HISTORY"; history: HistoryMessage }
  | { type: "REPORT"; report: ReportMessage }
  | { type: "STREAMS"; streams: StreamsMessage }
  | { type: "NEW_SESSION" };

// A new sample, and its values appended to the kept seconds. When the stream is gone, the last sample comes again
// with the same t: that is not a new second.
const withSample = (state: SessionState, sample: SampleMessage): SessionState => {
  const { values } = sample;
  const last = state.history.length > 0 ? state.history[state.history.length - 1] : undefined;
  const history = last?.t === values.t ? state.history : [...state.history.slice(1 - HISTORY_LENGTH), values];
  return { ...state, sample, history };
};

// The events and problems of a history answer that the panel did not know yet; the same state when there are none.
const withHistory = (state: SessionState, history: HistoryMessage): SessionState => {
  const events = addEvents(state.events, history.events);
  const problems = addProblems(state.problems, history.problems, false);
  return events === state.events && problems === state.problems ? state : { ...state, events, problems };
};

// The state after an action. An event or a history answer with nothing new returns the same state, so React does
// not render the panel again.
function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case "SAMPLE":
      return withSample(state, action.sample);
    case "SESSION":
      return { ...state, session: action.session };
    case "EVENT": {
      const events = addEvents(state.events, [action.event]);
      return events === state.events ? state : { ...state, events };
    }
    case "PROBLEM":
      return { ...state, problems: addProblems(state.problems, [action.problem], true) };
    case "HISTORY":
      return withHistory(state, action.history);
    case "REPORT":
      return { ...state, report: action.report };
    case "STREAMS":
      return { ...state, streams: action.streams };
    case "NEW_SESSION":
      return initialState;
    default:
      return state;
  }
}

// The action of each message the state is made of. A Map, not an object: an id such as "toString" finds nothing.
const ACTIONS = new Map<string, (data: unknown) => Action>([
  [MESSAGES.VTT_SAMPLE, (data) => ({ type: "SAMPLE", sample: data as SampleMessage })],
  [MESSAGES.VTT_SESSION, (data) => ({ type: "SESSION", session: data as SessionMessage })],
  [MESSAGES.VTT_EVENT, (data) => ({ type: "EVENT", event: data as EventMessage })],
  [MESSAGES.VTT_PROBLEM, (data) => ({ type: "PROBLEM", problem: data as ProblemMessage })],
  [MESSAGES.VTT_HISTORY, (data) => ({ type: "HISTORY", history: data as HistoryMessage })],
  [MESSAGES.VTT_REPORT, (data) => ({ type: "REPORT", report: data as ReportMessage })],
  [MESSAGES.VTT_STREAMS, (data) => ({ type: "STREAMS", streams: data as StreamsMessage })],
  [CONST.CONTEXT_MENU_VTT_WAS_CLICKED, () => ({ type: "NEW_SESSION" })],
]);

interface Props {
  children: React.ReactNode;
}

// Listens to the injection and keeps the session's state for the panel.
export const SessionContextProvider: FC<Props> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => onPageMessage((message) => {
    const action = ACTIONS.get(message.id)?.(message.data);
    if (action) {
      dispatch(action);
    }
  }), []);

  return (
    <SessionContext.Provider value={state}>
      {children}
    </SessionContext.Provider>
  );
};
