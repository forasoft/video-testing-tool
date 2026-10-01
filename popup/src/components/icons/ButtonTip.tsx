// The tooltip of the panel's icon buttons (Collapse, Close, Back to main).
import React from "react";
import styles from "./ButtonTip.module.css";

interface ButtonTipProps {
  // The same text as the button's aria-label.
  text: string;
  // Under the button, or beside it (to its right).
  placement?: "below" | "beside";
  // Under the button: the edge of it the tooltip keeps to — buttons at the panel's right edge open it to the left.
  align?: "start" | "end";
}

// The tooltip of an icon button (PRD §17): shown after 500 ms of hover or keyboard focus. The button says the same
// with its aria-label, so the tooltip is hidden from screen readers.
export const ButtonTip: React.FC<ButtonTipProps> = ({ text, placement = "below", align = "end" }) => (
  <span className={`${styles.tip} ${styles[placement]} ${placement === "below" ? styles[align] : ""}`} aria-hidden="true" data-button-tip>
    {text}
  </span>
);
