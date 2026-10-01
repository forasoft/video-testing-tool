import React, {
  FC, useEffect, useState
} from "react";
import { CONST } from "../CONST/const";
import { FpsMessage, MESSAGES } from "../../../shared/protocol";
import { noteFpsRender } from "../utils/perf";

// Frame rate four times a second (VTT_FPS, PRD §6.2), apart from the rest of the session: it draws again only the
// Frame rate values and Freezes & Stalls, not the whole panel (≤ 1 full render a second, PRD §18).
export const FpsContext = React.createContext<FpsMessage | null>(null);

interface Props {
  children: React.ReactNode;
}

export const FpsContextProvider: FC<Props> = ({ children }) => {
  const [fps, setFps] = useState<FpsMessage | null>(null);

  useEffect(() => {
    const callback = (e: MessageEvent) => {
      if (e.data?.id === MESSAGES.VTT_FPS) {
        setFps(e.data.data);
      }
      // A new session: its first second shows the sample's value until VTT_FPS comes.
      if (e.data?.id === CONST.CONTEXT_MENU_VTT_WAS_CLICKED) {
        setFps(null);
      }
    };
    window.addEventListener("message", callback);
    return () => window.removeEventListener("message", callback);
  }, []);

  useEffect(() => {
    if (fps) {
      noteFpsRender();
    }
  }, [fps]);

  return (
    <FpsContext.Provider value={fps}>
      {children}
    </FpsContext.Provider>
  );
};
