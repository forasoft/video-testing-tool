import React, { useRef, useState } from "react";
import styles from "./Timeline.module.css";
import { TimeWindow } from "./scale";
import { useWidth } from "./useWidth";

// A press that moves less than this is a click, not a drag.
const DRAG_PX = 3;
// The tooltip keeps this far from the cursor line and inside the rows.
const TOOLTIP_GAP = 10;
const TOOLTIP_HEIGHT = 96;

// The second under the cursor and what its tooltip says (PRD §11.3).
export interface Cursor {
  t: number;
  title: string;
  lines: string[];
}

interface ChartOverlayProps {
  window: TimeWindow;
  // The window can be dragged: it is shorter than the history.
  draggable: boolean;
  onDragStart: () => void;
  // Seconds the window moved since the drag started; later is positive.
  onDrag: (dt: number) => void;
  // The time under the pointer; null — the pointer left the plots or drags them.
  onHover: (t: number | null) => void;
  // A click (a press without a drag): its time, where it was (px from the plots' top-left) and
  // the plots' width.
  onPick: (t: number, at: { x: number; y: number }, width: number) => void;
  cursor: Cursor | null;
}

// A layer over the plots of all rows (PRD §11.3): hovering shows the cursor through all of them
// with the tooltip, dragging moves the window in time.
export const ChartOverlay: React.FC<ChartOverlayProps> = ({
  window: shown, draggable, onDragStart, onDrag, onHover, onPick, cursor,
}) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);
  const [pointerY, setPointerY] = useState(0);
  const span = shown.to - shown.from;

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) {
      return;
    }
    drag.current = { x: e.clientX, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const box = e.currentTarget.getBoundingClientRect();
    // The button was released outside the panel: the page got the pointerup, not the iframe.
    if (drag.current && e.buttons === 0) {
      drag.current = null;
    }
    const current = drag.current;
    const dx = current ? e.clientX - current.x : 0;
    // A press that moved is a drag, not a click, even where the window cannot move.
    if (current && !current.moved && Math.abs(dx) >= DRAG_PX) {
      current.moved = true;
      onHover(null);
      if (draggable) {
        onDragStart();
      }
    }
    if (!current || !current.moved) {
      if (width > 0) {
        setPointerY(e.clientY - box.top);
        onHover(shown.from + ((e.clientX - box.left) / width) * span);
      }
      return;
    }
    if (draggable && width > 0) {
      onDrag((-dx / width) * span);
    }
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    drag.current = null;
    if (current && !current.moved && e.type === "pointerup" && width > 0) {
      const box = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - box.left;
      onPick(shown.from + (x / width) * span, { x, y: e.clientY - box.top }, width);
    }
  };

  const onDragEnd = () => {
    drag.current = null;
  };

  const x = cursor && width > 0 ? ((cursor.t - shown.from) / span) * width : null;
  const visible = x !== null && x >= 0 && x <= width;
  const height = ref.current?.clientHeight ?? 0;
  // To the right of the cursor, or to the left of it in the right half.
  const left = visible && (x as number) > width / 2;

  return (
    <div
      ref={ref}
      className={`${styles.overlay} ${draggable ? styles.draggable : ""}`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onDragEnd}
      onLostPointerCapture={onDragEnd}
      onPointerLeave={() => onHover(null)}
      data-chart-overlay
    >
      {visible && cursor && (
        <>
          <div className={styles.cursor} style={{ left: x as number }} data-cursor={cursor.t} />
          <div
            className={styles.tooltip}
            role="tooltip"
            style={{
              top: Math.max(0, Math.min(pointerY - TOOLTIP_HEIGHT / 2, height - TOOLTIP_HEIGHT)),
              ...(left
                ? { right: width - (x as number) + TOOLTIP_GAP }
                : { left: (x as number) + TOOLTIP_GAP }),
            }}
            data-cursor-tooltip
          >
            <strong className={styles.tooltipTitle}>{cursor.title}</strong>
            {/* By position: two events of a second can have the same name. */}
            {cursor.lines.map((line, i) => (
              <span key={i} className={styles.tooltipLine}>{line}</span>
            ))}
          </div>
        </>
      )}
    </div>
  );
};
