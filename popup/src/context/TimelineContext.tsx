// The state of the Timeline tab that outlives the tab: its window, Live and the open card.
import React, {
  FC, useCallback, useEffect, useMemo, useState
} from "react";
import { CONST } from "../CONST/const";
import { onPageMessage } from "../utils/page";
import { WindowRange } from "../components/expanded/timeline/window";

// How the timeline is viewed (PRD §11.1, §11.3). It outlives the tab: switching to Report and
// back keeps the window and Live (§16 F4).
interface TimelineView {
  range: WindowRange;
  // The window follows the time.
  live: boolean;
  // The window's right edge while not live, seconds from the session start.
  end: number | null;
  // The problem whose card is open over the charts (PRD §12.2).
  open: number | null;
}

interface ContextValue {
  view: TimelineView;
  setRange: (range: WindowRange) => void;
  // Back to the current time, following it.
  goLive: () => void;
  // Stops following the time: the window's right edge stays at `end`.
  pan: (end: number) => void;
  // Opens a problem's card with the window's right edge at `end` (PRD §11.3).
  showProblem: (id: number, end: number) => void;
  closeProblem: () => void;
}

const initialView: TimelineView = {
  range: "last2", live: true, end: null, open: null,
};

// Read by the Timeline: the window it draws, and the changes its controls, drags and clicks make.
export const TimelineContext = React.createContext({} as ContextValue);

interface Props {
  children: React.ReactNode;
}

// Provided in App, above the tabs, so that the view stays while the Report is shown.
export const TimelineContextProvider: FC<Props> = ({ children }) => {
  const [view, setView] = useState(initialView);

  // A new session starts with the default window.
  useEffect(() => onPageMessage((message) => {
    if (message.id === CONST.CONTEXT_MENU_VTT_WAS_CLICKED) {
      setView(initialView);
    }
  }), []);

  const setRange = useCallback((range: WindowRange) => setView((prev) => ({ ...prev, range })), []);
  const goLive = useCallback(() => setView((prev) => ({ ...prev, live: true, end: null })), []);
  const pan = useCallback((end: number) => setView((prev) => ({ ...prev, live: false, end })), []);
  const showProblem = useCallback((id: number, end: number) => setView((prev) => ({
    ...prev, live: false, end, open: id,
  })), []);
  const closeProblem = useCallback(() => setView((prev) => ({ ...prev, open: null })), []);

  const value = useMemo(() => ({
    view, setRange, goLive, pan, showProblem, closeProblem,
  }), [view, setRange, goLive, pan, showProblem, closeProblem]);

  return (
    <TimelineContext.Provider value={value}>
      {children}
    </TimelineContext.Provider>
  );
};
