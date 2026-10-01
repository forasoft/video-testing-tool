// The Events row of the Timeline: a numbered circle per event, with a tip of what happened.
import React, {
  useEffect, useRef, useState
} from "react";
import styles from "./Timeline.module.css";
import { mmss } from "../../../../../shared/format";
import { EventMessage } from "../../../../../shared/protocol";
import { TimeWindow } from "./scale";
import { useWidth } from "./useWidth";
import { groupEvents, groupLabel, groupTone } from "./eventGroups";

const BAND_HEIGHT = 24;
const CIRCLE = 14;
// The tip of a circle near an edge opens towards the middle.
const TIP_EDGE_PX = 120;

interface EventsBandProps {
  window: TimeWindow;
  events: EventMessage[];
}

// The events band under the time axis (PRD §11.2, §11.3): a circle with the number of each
// event in the window, events closer than 16 px in one `+N` circle; a click shows
// `{m:ss} · {label}` of each.
export const EventsBand: React.FC<EventsBandProps> = ({ window, events }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  // The first event of the group whose tip is open.
  const [open, setOpen] = useState<number | null>(null);
  const x = (t: number) => ((t - window.from) / (window.to - window.from)) * width;
  const inside = events.filter((e) => e.t >= window.from && e.t <= window.to);
  const groups = width > 0 ? groupEvents(inside, x) : [];

  useEffect(() => {
    if (open === null) {
      return undefined;
    }
    const close = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest("[data-event-group]"))) {
        setOpen(null);
      }
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className={styles.row} data-row="Events">
      <div className={styles.label}>
        <div className={styles.name}>Events</div>
      </div>
      <div ref={ref} className={`${styles.plot} ${styles.events}`} style={{ height: BAND_HEIGHT }}>
        {groups.map((group) => {
          const key = group.events[0].n;
          const lines = group.events.map((e) => `${mmss(e.t)} · ${e.label}`);
          const left = Math.min(Math.max(group.x, CIRCLE / 2), width - CIRCLE / 2);
          let side = styles.tipMiddle;
          if (left < TIP_EDGE_PX) {
            side = styles.tipStart;
          } else if (left > width - TIP_EDGE_PX) {
            side = styles.tipEnd;
          }
          return (
            <div key={key} className={styles.eventGroup} style={{ left }} data-event-group={group.events.map((e) => e.n).join(",")}>
              <button
                type="button"
                className={`${styles.event} ${styles[`tone_${groupTone(group)}`]}`}
                aria-label={lines.join("; ")}
                aria-expanded={open === key}
                onClick={() => setOpen(open === key ? null : key)}
              >
                {groupLabel(group)}
              </button>
              {open === key && (
                <div className={`${styles.eventTip} ${side}`} role="tooltip" data-event-tip>
                  {group.events.map((e, i) => <span key={e.n} className={styles.tooltipLine}>{lines[i]}</span>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};
