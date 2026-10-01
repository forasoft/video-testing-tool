import React, {
  FC, ReactElement, useCallback, useEffect, useMemo, useState
} from "react";
import { CONST } from "../CONST/const";
import {
  ExpandedTab, MESSAGES, PanelMode, SetModeMessage
} from "../../../shared/protocol";
import { postToWindow } from "../utils/postToWindow";

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
  state?: IState;
  children: ReactElement | ReactElement[];
}

export const DisplayContext = React.createContext({} as ContextValue);

export const DisplayContextProvider: FC<IProps> = ({
  state: defaultState = { mode: "compact", tab: "timeline" },
  children,
}) => {
  const [state, setState] = useState(defaultState);
  const [mainScreen, setMainScreen] = useState(true);

  useEffect(() => {
    const callback = (e: MessageEvent) => {
      if (e.data?.id === MESSAGES.VTT_SET_MODE) {
        const { mode, tab } = e.data.data as SetModeMessage;
        setState((prevState) => ({ mode, tab: tab ?? prevState.tab }));
      }
      // A new session opens Expanded on Timeline again.
      if (e.data?.id === CONST.CONTEXT_MENU_VTT_WAS_CLICKED) {
        setState((prevState) => ({ ...prevState, tab: "timeline" }));
      }
    };

    window.addEventListener("message", callback);

    return () => {
      window.removeEventListener("message", callback);
    };
  }, []);

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
