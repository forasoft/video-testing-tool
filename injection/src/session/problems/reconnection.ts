// Problem 5, Reconnection (PRD §12.3, card §12.4): ICE lost the connection after it had been up.
import { pathLabel } from "../connection";
import { RtpStats } from "../extract";
import { Description, Detector, MIN_DURATION_S, Problem, ProblemEngine, Signal } from "./engine";

// Not connected again after this long → closed as "not recovered", the session is disconnected.
export const NOT_RECOVERED_S = 30;

export interface ReconnectionData {
  worst: "disconnected" | "failed";
  recovered: boolean;
  // Candidate types and protocol once media flows again.
  pathAfter: string | null;
}

const UP: RTCIceConnectionState[] = ["connected", "completed"];
const DOWN: RTCIceConnectionState[] = ["disconnected", "failed"];

// When the last packet arrived on the selected pair, seconds from the session start, given the
// pair's report of the sample taken at `t`.
export const lastPacketTime = (pair: RtpStats | undefined, t: number): number | null => {
  const last = pair?.lastPacketReceivedTimestamp;
  const now = pair?.timestamp;
  if (typeof last !== "number" || typeof now !== "number" || last <= 0 || last > now) {
    return null;
  }
  return Math.round((t - (now - last) / 1000) * 1000) / 1000;
};

export class Reconnection implements Detector<ReconnectionData> {
  readonly type = "reconnection";
  // ICE has been connected during the session.
  private wasUp = false;

  onSignal(signal: Signal, engine: ProblemEngine): void {
    const open = engine.current<ReconnectionData>(this.type);

    if (UP.includes(signal.state)) {
      this.wasUp = true;
      if (open) {
        open.data.recovered = true;
        engine.close(open, signal.t);
        if (engine.duration(open) >= MIN_DURATION_S) {
          engine.events.add(signal.t, "reconnect", "Reconnected", "green");
        }
      }
      return;
    }

    if (!DOWN.includes(signal.state) || !this.wasUp) {
      return;
    }
    if (open) {
      if (signal.state === "failed") {
        open.data.worst = "failed";
      }
      return;
    }
    // ICE notices a drop seconds after the packets stop: the problem starts with the last packet.
    const { lastPacketT, t } = signal;
    const tStart = lastPacketT !== null && lastPacketT < t && t - lastPacketT < NOT_RECOVERED_S ? lastPacketT : t;
    engine.open<ReconnectionData>(this.type, tStart, {
      worst: signal.state === "failed" ? "failed" : "disconnected",
      recovered: false,
      pathAfter: null,
    });
  }

  onSample(engine: ProblemEngine): void {
    const open = engine.current<ReconnectionData>(this.type);
    if (open && engine.t - open.tStart >= NOT_RECOVERED_S) {
      engine.close(open, open.tStart + NOT_RECOVERED_S);
      engine.endSession("not recovered");
    }

    // The path after a reconnection: from the first sample with a selected pair after it.
    const path = pathLabel(engine.connection);
    if (!path) {
      return;
    }
    engine.problems.forEach((problem) => {
      const p = problem as Problem<ReconnectionData>;
      if (p.type === this.type && p.data.recovered && p.data.pathAfter === null) {
        p.data.pathAfter = path;
      }
    });
  }

  describe(problem: Problem<ReconnectionData>, engine: ProblemEngine): Description {
    const { worst, recovered, pathAfter } = problem.data;
    const down = `${engine.duration(problem).toFixed(1)} s`;
    const closed = problem.tEnd !== null;
    const ice = ["connected", worst];
    if (closed) {
      ice.push(recovered ? "connected" : "not recovered");
    }

    return {
      title: "Reconnection",
      category: "Network",
      severity: "severe",
      oneLine: closed && !recovered ? `${down}, not recovered` : down,
      card: {
        series: engine.cardSeries("v_bitrate", problem),
        rows: [
          ["Down for", down],
          ["ICE state", ice.join(" → ")],
          ["Path after", pathAfter ?? "—"],
        ],
        likelyCause: `The connection to the sender was lost for ${down}.`,
        check: "Network drop on this machine (Wi-Fi, VPN, sleep) or on the sender's; if all participants reconnected at once — the SFU.",
      },
    };
  }
}
