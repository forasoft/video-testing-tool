// The latest Frame rate, for the tiles of Compact and Mini and the Frame rate label of the Timeline.
import React, {
  FC, useEffect, useState
} from "react";
import { CONST } from "../CONST/const";
import { FpsMessage, MESSAGES } from "../../../shared/protocol";
import { onPageMessage } from "../utils/page";
import { noteFpsRender } from "../utils/perf";

// Frame rate four times a second (VTT_FPS, PRD §6.2), apart from the rest of the session: it draws again only the
// Frame rate values and Freezes & Stalls, not the whole panel (≤ 1 full render a second, PRD §18).
export const FpsContext = React.createContext<FpsMessage | null>(null);

interface Props {
  children: React.ReactNode;
}

// Keeps the latest VTT_FPS (null until a session's first one) and counts its renders for __vtt.debug.perf().
export const FpsContextProvider: FC<Props> = ({ children }) => {
  const [fps, setFps] = useState<FpsMessage | null>(null);

  useEffect(() => onPageMessage((message) => {
    if (message.id === MESSAGES.VTT_FPS) {
      setFps(message.data as FpsMessage);
    }
    // A new session: its first second shows the sample's value until VTT_FPS comes.
    if (message.id === CONST.CONTEXT_MENU_VTT_WAS_CLICKED) {
      setFps(null);
    }
  }), []);

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
