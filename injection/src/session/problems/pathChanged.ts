// Problem 4, Connection path changed (PRD §12.3, card §12.4): the selected candidate pair changed to
// a relay, or to a route with a much longer round trip.
import { CANDIDATE_TYPES } from "shared/constants/sampleFields";
import { pathLabel } from "../connection";
import { Description, Detector, median, Problem, ProblemEngine } from "./engine";

// RTT medians over this many seconds before the change and after it (the change's sample included).
export const WINDOW_S = 10;
// A change to a non-relay pair is a problem when the RTT median grew this much.
export const RTT_GROWTH = 1.5;
// The problem lasts this long after the change.
export const DURATION_S = 3;
// "Before t" in sample windows: the sample at t itself is left out.
const BEFORE = 1e-6;

const RELAY = CANDIDATE_TYPES.indexOf("relay");

export interface PathChangedData {
  // The path_change event, seconds from the session start.
  event: number;
  // `local→remote · proto` before and after the change.
  before: string | null;
  after: string | null;
  relay: boolean;
  // The type the connection chip shows and the protocol of the new path.
  type: string | null;
  proto: string | null;
  // TURN server of the new path, `host:port`.
  turn: string | null;
}

type Change = Omit<PathChangedData, "event"> & { event: number };

const round = (value: number | null) => (value === null ? "—" : String(Math.round(value)));

export class PathChanged implements Detector<PathChangedData> {
  readonly type = "path_changed";
  private readonly turn: () => string | null;
  // Time of the latest path_change event taken.
  private seen = -Infinity;
  // The path of the latest sample that had a selected pair.
  private path: string | null = null;
  // Changes to a non-relay pair, waiting for 10 s of RTT after them.
  private waiting: Change[] = [];

  // `turn` — the TURN server of the selected pair now (`host:port`), null without one.
  constructor(turn: () => string | null) {
    this.turn = turn;
  }

  onSample(engine: ProblemEngine): void {
    const now = pathLabel(engine.connection);
    engine.events.between("path_change", this.seen, engine.t)
      .filter((e) => e.t > this.seen)
      .forEach((e) => {
        this.seen = e.t;
        const change: Change = {
          event: e.t,
          before: this.path,
          after: now,
          relay: engine.sample?.pair_type === RELAY,
          type: engine.connection?.type ?? null,
          proto: engine.connection?.proto ?? null,
          turn: this.turn(),
        };
        if (change.relay) {
          this.start(change, engine);
        } else {
          this.waiting.push(change);
        }
      });
    if (now) {
      this.path = now;
    }

    // A change to a non-relay pair is judged once 10 s of RTT after it are known.
    this.waiting = this.waiting.filter((change) => {
      if (engine.t < change.event + WINDOW_S) {
        return true;
      }
      const [before, after] = this.rtt(change.event, engine);
      if (before !== null && after !== null && after >= RTT_GROWTH * before) {
        this.start(change, engine);
      }
      return false;
    });

    const open = engine.current<PathChangedData>(this.type);
    if (open && engine.t >= open.data.event + DURATION_S) {
      engine.close(open, open.data.event + DURATION_S);
    }
  }

  // Problems of one type do not overlap: a change within the previous one's 3 s continues it.
  private start(change: Change, engine: ProblemEngine): void {
    const last = engine.problems.filter((p) => p.type === this.type).pop() as Problem<PathChangedData> | undefined;
    if (last && (last.tEnd === null || last.tEnd > change.event)) {
      Object.assign(last.data, { ...change, before: last.data.before, event: change.event });
      if (last.tEnd !== null) {
        last.tEnd = null;
      }
      return;
    }
    engine.open<PathChangedData>(this.type, change.event, change);
  }

  // RTT medians of the 10 s before the change and of the 10 s after it (up to now), ms.
  private rtt(event: number, engine: ProblemEngine): [number | null, number | null] {
    return [
      median(engine.values("rtt", event - WINDOW_S, event - BEFORE)),
      median(engine.values("rtt", event, event + WINDOW_S)),
    ];
  }

  describe(problem: Problem<PathChangedData>, engine: ProblemEngine): Description {
    const {
      event, before, after, relay, type, proto, turn,
    } = problem.data;
    const [rttBefore, rttAfter] = this.rtt(event, engine);
    const loss = engine.values("v_loss", event, event + WINDOW_S);
    const lossAfter = loss.length ? loss.reduce((sum, v) => sum + v, 0) / loss.length : null;
    const delta = rttBefore !== null && rttAfter !== null ? Math.max(0, Math.round(rttAfter - rttBefore)) : null;
    const rtt = `RTT ${round(rttBefore)} → ${round(rttAfter)} ms`;

    return {
      title: "Connection path changed",
      category: "Network",
      severity: "warn",
      oneLine: `→ ${type ?? "—"}${proto ? ` · ${proto}` : ""}, ${rtt}`,
      card: {
        series: engine.cardSeries("rtt", problem),
        rows: [
          ["Path", `${before ?? "—"} → ${after ?? "—"}`],
          ["RTT", `${round(rttBefore)} → ${round(rttAfter)} ms`],
          ["Packet loss after", lossAfter === null ? "—" : `${lossAfter.toFixed(1)} %`],
          ["TURN", turn ?? "—"],
        ],
        likelyCause: `The direct path failed; media now goes through ${relay ? `a TURN relay (${proto ?? "—"})` : "a different route"}.`,
        check: `UDP blocked or Wi-Fi roaming? Expect +${delta ?? "—"} ms delay while on relay.`,
      },
    };
  }
}
