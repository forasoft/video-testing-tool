// The events band of the timeline (PRD §11.2): a circle per event, events closer than 16 px
// share one circle with `+N`.
import { EventMessage, EventTone } from "../../../../../shared/protocol";

export const EVENT_GAP_PX = 16;

export interface EventGroup {
  // Of the group's first event, px.
  x: number;
  events: EventMessage[];
}

// In time order; an event joins the group while it is closer than `gap` to the group's first one.
export const groupEvents = (events: EventMessage[], x: (t: number) => number, gap = EVENT_GAP_PX): EventGroup[] => [...events]
  .sort((a, b) => a.t - b.t || a.n - b.n)
  .reduce<EventGroup[]>((groups, event) => {
    const at = x(event.t);
    const last = groups[groups.length - 1];
    if (last && at - last.x < gap) {
      last.events.push(event);
    } else {
      groups.push({ x: at, events: [event] });
    }
    return groups;
  }, []);

// The circle's text: the event's number, or `+N` for N events.
export const groupLabel = ({ events }: EventGroup): string => (events.length === 1 ? String(events[0].n) : `+${events.length}`);

// The color of the events' kind (§12.1); gray when they differ.
export const groupTone = ({ events }: EventGroup): EventTone => (
  events.every((e) => e.tone === events[0].tone) ? events[0].tone : "gray"
);
