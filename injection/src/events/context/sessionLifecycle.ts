import { CONSTS } from "../../consts/events";

interface IRegisterSessionMessageHandlerProps {
  stopCalculation: () => void;
}

// Close, Back to main or another stream picked stop the session (PRD §14.3).
export const registerSessionMessageHandler = (
  props: IRegisterSessionMessageHandlerProps
): void => {
  const { stopCalculation } = props;

  const callback = (e: MessageEvent) => {
    if (
      [
        CONSTS.VTT_CONTEXT_BTN_CLICK,
        CONSTS.VTT_HIDE,
        CONSTS.VTT_STOP_CALCULATION,
      ].includes(e.data.id)
    ) {
      stopCalculation();
      window.removeEventListener("message", callback, false);
    }
  };

  window.addEventListener("message", callback, false);
};
