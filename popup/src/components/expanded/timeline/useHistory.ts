// The history of the Timeline's window when the samples the popup keeps do not cover it.
import {
  useCallback, useEffect, useRef, useState
} from "react";
import {
  GetHistoryMessage, HistoryMessage, MESSAGES,
} from "../../../../../shared/protocol";
import { onPageMessage, postToWindow } from "../../../utils/page";
import { TimeWindow } from "./scale";
import {
  covers, historyRequest, WindowRange
} from "./window";

// The whole session is asked for again this often while Live (PRD §11.1).
const WHOLE_REFRESH_MS = 5000;

interface Question {
  range: WindowRange;
  request: GetHistoryMessage;
}

interface Answer {
  range: WindowRange;
  message: HistoryMessage;
}

// Samples of the windows the popup does not keep: VTT_GET_HISTORY → VTT_HISTORY (PRD §21).
// Whole session — on switching to it and every 5 s while Live (a refresh, answered with the next
// sample, PRD §18); a dragged 2-minute window — when it leaves the kept samples and what was asked
// before. Only the answer to the latest question is used, and only in the window range it was
// asked for.
export const useHistory = (
  range: WindowRange,
  live: boolean,
  { from, to }: TimeWindow,
  kept: number | null,
  now: number
): HistoryMessage | null => {
  const [answer, setAnswer] = useState<Answer | null>(null);
  const asked = useRef<Question | null>(null);
  const latest = useRef({
    from, to, kept, now,
  });
  latest.current = {
    from, to, kept, now,
  };

  const ask = useCallback((question: Question) => {
    asked.current = question;
    postToWindow(MESSAGES.VTT_GET_HISTORY, question.request);
  }, []);

  useEffect(() => onPageMessage((received) => {
    if (received.id !== MESSAGES.VTT_HISTORY) {
      return;
    }
    const message = received.data as HistoryMessage;
    const question = asked.current;
    if (question?.request.from === message.from && question.request.to === message.to) {
      setAnswer({ range: question.range, message });
    }
  }), []);

  // The whole session while Live: now and every 5 s.
  useEffect(() => {
    if (range !== "whole" || !live) {
      return undefined;
    }
    const refresh = (again: boolean) => {
      const current = latest.current;
      const request = historyRequest("whole", true, current, current.kept, current.now);
      if (request) {
        ask({ range: "whole", request: again ? { ...request, refresh: true } : request });
      }
    };
    refresh(false);
    const timer = setInterval(() => refresh(true), WHOLE_REFRESH_MS);
    return () => clearInterval(timer);
  }, [range, live, ask]);

  // A window that does not follow the time: asked for when it moved out of what was asked.
  useEffect(() => {
    if (live) {
      return;
    }
    const shown = { from, to };
    const request = historyRequest(range, false, shown, kept, now);
    const previous = asked.current;
    if (!request) {
      return;
    }
    if (previous?.range === range && (range === "whole" ? previous.request.to === request.to : covers(previous.request, shown, kept))) {
      return;
    }
    ask({ range, request });
  }, [range, live, from, to, kept, now, ask]);

  return answer?.range === range && !(range === "last2" && live) ? answer.message : null;
};
