import React, {
  FC, ReactElement, useState, useEffect
} from "react";
import { CONST } from "../CONST/const";

interface ContextValue {
  state: IState;
}

interface IState {
  fullSize: boolean;
}

interface IProps {
  state?: IState;
  children: ReactElement | ReactElement[];
}

export const DisplayContext = React.createContext({} as ContextValue);

export const DisplayContextProvider: FC<IProps> = (props) => {
  const { state: defaultState, children } = props;
  const [state, setState] = useState(defaultState || { fullSize: true });

  useEffect(() => {
    const callback = (e: MessageEvent) => {
      if (e.data.id === CONST.VTT_RESIZE_BUTTON_CLICK) {
        setState((prevState) => ({
          ...prevState,
          fullSize: e.data.data.fullSize,
        }));
      }
    };

    window.addEventListener("message", callback);

    return () => {
      window.removeEventListener("message", callback);
    };
  }, []);

  return (
    <DisplayContext.Provider value={{ state }}>
      {children}
    </DisplayContext.Provider>
  );
};

DisplayContextProvider.defaultProps = {
  state: {
    fullSize: true,
  },
};
