import React, {
  FC, useCallback, useEffect, useMemo, useState
} from "react";
import { CONST } from "../CONST/const";

// How the Report is viewed (PRD §13.2): the problems whose cards are open under their rows. It outlives
// the tab: switching to Timeline and back keeps them open (§16 F4).
interface ContextValue {
  expanded: number[];
  // Opens a problem's card, or closes it when it is open.
  toggle: (id: number) => void;
}

export const ReportContext = React.createContext({} as ContextValue);

interface Props {
  children: React.ReactNode;
}

export const ReportContextProvider: FC<Props> = ({ children }) => {
  const [expanded, setExpanded] = useState<number[]>([]);

  // A new session starts with every card closed.
  useEffect(() => {
    const callback = (e: MessageEvent) => {
      if (e.data?.id === CONST.CONTEXT_MENU_VTT_WAS_CLICKED) {
        setExpanded([]);
      }
    };
    window.addEventListener("message", callback);
    return () => window.removeEventListener("message", callback);
  }, []);

  const toggle = useCallback((id: number) => setExpanded((prev) => (
    prev.includes(id) ? prev.filter((open) => open !== id) : [...prev, id]
  )), []);

  const value = useMemo(() => ({ expanded, toggle }), [expanded, toggle]);

  return (
    <ReportContext.Provider value={value}>
      {children}
    </ReportContext.Provider>
  );
};
