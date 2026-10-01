import React, {
  FC, useEffect, useReducer
} from "react";
import { CONST } from "../CONST/const";
import {
  EventMessage, HistoryMessage, MESSAGES, ProblemMessage, ReportMessage, SampleMessage, SessionMessage, StreamsMessage
} from "../../../shared/protocol";
import { addEvents, addProblems, SessionState } from "./sessionStore";

export type { SessionState };

// Seconds of samples the popup keeps for the timeline's last 2 minutes (PRD §11.1), with a margin.
export const HISTORY_LENGTH = 125;

const initialState: SessionState = {
  session: null,
  sample: null,
  history: [],
  events: [],
  problems: [],
  report: null,
  streams: [],
};

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

function reducer(state: SessionState, action: Action): SessionState {
  switch (action.type) {
    case "SAMPLE": {
      const { values } = action.sample;
      const last = state.history[state.history.length - 1];
      // When the stream is gone, the last sample comes again with the same t: not a new second.
      const history = last && last.t === values.t
        ? state.history
        : [...state.history.slice(1 - HISTORY_LENGTH), values];
      return { ...state, sample: action.sample, history };
    }
    case "SESSION":
      return { ...state, session: action.session };
    case "EVENT": {
      const events = addEvents(state.events, [action.event]);
      return events === state.events ? state : { ...state, events };
    }
    case "PROBLEM":
      return { ...state, problems: addProblems(state.problems, [action.problem], true) };
    case "HISTORY": {
      const events = addEvents(state.events, action.history.events ?? []);
      const problems = addProblems(state.problems, action.history.problems ?? [], false);
      return events === state.events && problems === state.problems ? state : { ...state, events, problems };
    }
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

interface Props {
  children: React.ReactNode;
}

export const SessionContextProvider: FC<Props> = ({ children }) => {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    const callback = (e: MessageEvent) => {
      switch (e.data?.id) {
        case MESSAGES.VTT_SAMPLE:
          dispatch({ type: "SAMPLE", sample: e.data.data });
          break;
        case MESSAGES.VTT_SESSION:
          dispatch({ type: "SESSION", session: e.data.data });
          break;
        case MESSAGES.VTT_EVENT:
          dispatch({ type: "EVENT", event: e.data.data });
          break;
        case MESSAGES.VTT_PROBLEM:
          dispatch({ type: "PROBLEM", problem: e.data.data });
          break;
        case MESSAGES.VTT_HISTORY:
          dispatch({ type: "HISTORY", history: e.data.data });
          break;
        case MESSAGES.VTT_REPORT:
          dispatch({ type: "REPORT", report: e.data.data });
          break;
        case MESSAGES.VTT_STREAMS:
          dispatch({ type: "STREAMS", streams: e.data.data });
          break;
        case CONST.CONTEXT_MENU_VTT_WAS_CLICKED:
          dispatch({ type: "NEW_SESSION" });
          break;
        default:
          break;
      }
    };

    window.addEventListener("message", callback);

    return () => {
      window.removeEventListener("message", callback);
    };
  }, []);

  return (
    <SessionContext.Provider value={state}>
      {children}
    </SessionContext.Provider>
  );
};
