// How the panel is displayed: the mode main.js gives it, the tab of Expanded, and whether the start screen is shown
// instead of a session.
import React, {
  FC, ReactElement, useCallback, useEffect, useMemo, useState
} from "react";
import { CONST } from "../CONST/const";
import {
  ExpandedTab, MESSAGES, PanelMode, SetModeMessage,
} from "../../../shared/protocol";
import { onPageMessage, postToWindow } from "../utils/page";

interface IState {
  // Set by main.js (PRD §8.1): it sizes the panel, the popup draws the layout of the mode.
  mode: PanelMode;
  // The last active tab of Expanded, kept for the session (PRD §8.3).
  tab: ExpandedTab;
}

interface ContextValue {
  state: IState;
  // Asks main.js for a mode (and the tab to open in Expanded); main.js sends it back.
  setMode: (mode: PanelMode, tab?: ExpandedTab) => void;
  setTab: (tab: ExpandedTab) => void;
  // The start screen (PRD §14.1) is shown instead of the session.
  mainScreen: boolean;
  setMainScreen: (value: boolean) => void;
}

interface IProps {
  children: ReactElement | ReactElement[];
}

// Compact, with Timeline as the tab of Expanded, until main.js says otherwise.
const INITIAL_STATE: IState = { mode: "compact", tab: "timeline" };

// Read by the layout to pick the screen, and by the controls that switch the mode or the tab.
export const DisplayContext = React.createContext({} as ContextValue);

// The mode changes only when main.js sends it (VTT_SET_MODE): main.js sizes the panel and tells the popup when to draw
// the mode's layout.
export const DisplayContextProvider: FC<IProps> = ({ children }) => {
  const [state, setState] = useState(INITIAL_STATE);
  const [mainScreen, setMainScreen] = useState(true);

  useEffect(() => onPageMessage((message) => {
    if (message.id === MESSAGES.VTT_SET_MODE) {
      const { mode, tab } = message.data as SetModeMessage;
      setState((prevState) => ({ mode, tab: tab ?? prevState.tab }));
    }
    // A new session opens Expanded on Timeline again.
    if (message.id === CONST.CONTEXT_MENU_VTT_WAS_CLICKED) {
      setState((prevState) => ({ ...prevState, tab: "timeline" }));
    }
  }), []);

  const setMode = useCallback((mode: PanelMode, tab?: ExpandedTab) => {
    const message: SetModeMessage = tab ? { mode, tab } : { mode };
    postToWindow(MESSAGES.VTT_SET_MODE, message);
  }, []);

  const setTab = useCallback((tab: ExpandedTab) => {
    setState((prevState) => ({ ...prevState, tab }));
  }, []);

  const value = useMemo(() => ({
    state, setMode, setTab, mainScreen, setMainScreen,
  }), [state, setMode, setTab, mainScreen]);

  return (
    <DisplayContext.Provider value={value}>
      {children}
    </DisplayContext.Provider>
  );
};
