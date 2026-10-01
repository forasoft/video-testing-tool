import React, {
  useContext, useEffect, useState
} from "react";
import styles from "./MarkButton.module.css";
import { SessionContext } from "../../context/SessionContext";
import { MESSAGES } from "../../../../shared/protocol";
import { postToWindow } from "../../utils/postToWindow";

// The text says `Marked` this long after a click (PRD §8.3).
const MARKED_MS = 1000;

interface MarkButtonProps {
  // 28 px in the Expanded header, 26 px in the Compact footer (PRD §8.3, §9.4).
  size: "header" | "footer";
}

// Mark, PRD §16 F6: a mark on the current second of the session — a blue circle on the events
// band. Only while the session collects data.
export const MarkButton: React.FC<MarkButtonProps> = ({ size }) => {
  const { session } = useContext(SessionContext);
  const [marked, setMarked] = useState(false);

  useEffect(() => {
    if (!marked) {
      return undefined;
    }
    const timer = setTimeout(() => setMarked(false), MARKED_MS);
    return () => clearTimeout(timer);
  }, [marked]);

  const onClick = () => {
    postToWindow(MESSAGES.VTT_MARK, {});
    setMarked(true);
  };

  return (
    <button
      type="button"
      className={`${styles.mark} ${styles[size]}`}
      disabled={session?.state !== "live"}
      onClick={onClick}
      data-mark={marked ? "marked" : "mark"}
    >
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M3.5 14.5V2.5M3.5 3h8.5l-2 3.25L12 9.5H3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {marked ? "Marked" : "Mark"}
    </button>
  );
};
