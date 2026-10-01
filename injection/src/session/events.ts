// Events of the session (PRD §12.1): point facts on the timeline, numbered through the session.
import { CANDIDATE_TYPES, SampleValues } from "shared/constants/sampleFields";
import { EventKind, EventMessage, EventTone } from "shared/protocol";

// PRD §6.4: the oldest events are dropped beyond this, except marks.
export const EVENT_LIMIT = 2000;
// A new frame height is a layer change once it has held this long.
export const LAYER_STABLE_S = 1;

export interface SessionEvent extends EventMessage {
  // layer_change: frame heights before and after.
  from?: number;
  to?: number;
}

const round = (t: number) => Math.round(t * 1000) / 1000;

export const firstFrameLabel = (t: number): string => `First frame ${t.toFixed(2)} s`;

export const layerLabel = (from: number, to: number): string => `${from}p → ${to}p`;

export class EventLog {
  events: SessionEvent[] = [];
  // Events and marks ever added: numbers are not reused after eviction.
  count = 0;
  marks = 0;
  private readonly send: (event: EventMessage) => void;

  constructor(send: (event: EventMessage) => void = () => undefined) {
    this.send = send;
  }

  add(t: number, kind: EventKind, label: string, tone: EventTone, detail: Pick<SessionEvent, "from" | "to"> = {}): SessionEvent {
    this.count += 1;
    const event: SessionEvent = { n: this.count, t: round(t), kind, label, tone, ...detail };
    this.events.push(event);
    this.evict();
    this.send({ n: event.n, t: event.t, kind, label, tone });
    return event;
  }

  mark(t: number): SessionEvent {
    this.marks += 1;
    return this.add(t, "mark", `Mark ${this.marks}`, "blue");
  }

  // Events of a kind with from ≤ t ≤ to.
  between(kind: EventKind, from: number, to: number): SessionEvent[] {
    return this.events.filter((e) => e.kind === kind && e.t >= from && e.t <= to);
  }

  private evict(): void {
    while (this.events.length > EVENT_LIMIT) {
      const oldest = this.events.findIndex((e) => e.kind !== "mark");
      if (oldest === -1) {
        return;
      }
      this.events.splice(oldest, 1);
    }
  }
}

// Events that follow from consecutive samples: layer changes and connection path changes.
export class SampleEvents {
  private readonly log: EventLog;
  // Frame height that has held for LAYER_STABLE_S, and a new one waiting to hold as long.
  height: number | null = null;
  candidate: { h: number; t: number } | null = null;
  // pair_changes of the last sample that had a selected pair.
  pairChanges: number | null = null;

  constructor(log: EventLog) {
    this.log = log;
  }

  onSample(s: SampleValues): void {
    if (s.t === null) {
      return;
    }
    this.layer(s.t, s.v_h);
    this.path(s.t, s.pair_type, s.pair_changes);
  }

  // The first height that holds is the starting layer, not a change.
  private layer(t: number, h: number | null): void {
    if (h === null) {
      return;
    }
    if (h === this.height) {
      this.candidate = null;
      return;
    }
    if (!this.candidate || this.candidate.h !== h) {
      this.candidate = { h, t };
      return;
    }
    if (t - this.candidate.t < LAYER_STABLE_S) {
      return;
    }
    if (this.height !== null) {
      const tone = h < this.height ? "yellow" : "green";
      this.log.add(this.candidate.t, "layer_change", layerLabel(this.height, h), tone, { from: this.height, to: h });
    }
    this.height = h;
    this.candidate = null;
  }

  // The first selected pair is the starting path; seconds without a pair (ICE restart) are skipped.
  private path(t: number, type: number | null, changes: number | null): void {
    if (type === null || changes === null) {
      return;
    }
    if (this.pairChanges !== null && changes > this.pairChanges) {
      this.log.add(t, "path_change", `Path → ${CANDIDATE_TYPES[type]}`, "yellow");
    }
    this.pairChanges = changes;
  }
}

// tab_hidden / tab_visible on visibilitychange; `now` — seconds from the session start.
export const trackVisibility = (log: EventLog, now: () => number): (() => void) => {
  const onVisibility = () => {
    if (document.hidden) {
      log.add(now(), "tab_hidden", "Tab hidden", "gray");
    } else {
      log.add(now(), "tab_visible", "Tab visible", "gray");
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => document.removeEventListener("visibilitychange", onVisibility);
};
