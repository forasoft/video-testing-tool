// The verdict chip and the connection line of Expanded (PRD §11.1, §8.3) as the popup draws them:
// the values come with VTT_SAMPLE / VTT_SESSION, only the text is put together here.
import {
  ConnectionInfo, Goodness, SessionState, VerdictInfo
} from "../../../../shared/protocol";

export type Tone = "green" | "yellow" | "red";

export interface Chip {
  text: string;
  tone: Tone;
}

// `● OK` green, `● Degraded 9.7 s` yellow, `● Severe 9.7 s` red; `● Disconnected` red once the
// stream is gone. Σ is shown with one decimal.
export const verdictChip = (verdict: VerdictInfo | undefined, state: SessionState | undefined): Chip => {
  if (state === "disconnected") {
    return { text: "Disconnected", tone: "red" };
  }
  if (!verdict || verdict.level === "OK") {
    return { text: "OK", tone: "green" };
  }
  return {
    text: `${verdict.level} ${verdict.degradedS.toFixed(1)} s`,
    tone: verdict.level === "Severe" ? "red" : "yellow",
  };
};

// A piece of the connection line; `goodness` — the color of the piece. Values are monospace (PRD
// §8.3), separators and labels (`plain`) are set in the text font, which keeps the line short.
export interface LinePart {
  text: string;
  goodness?: Goodness;
  plain?: boolean;
}

const SEPARATOR: LinePart = { text: " · ", plain: true };

// `H264 · opus · srflx→relay · udp · RTT 92 ms`: `→{remote type}` in the color of the connection
// path, `RTT {n} ms` in the color of the RTT; pieces the browser does not report are left out.
export const connectionLine = (connection: ConnectionInfo, rttGoodness?: Goodness): LinePart[] => {
  const groups: LinePart[][] = [
    [{ text: connection.videoCodec ?? "—" }],
    [{ text: connection.audioCodec ?? "—" }],
  ];
  if (connection.localType && connection.remoteType) {
    groups.push([{ text: connection.localType }, { text: `→${connection.remoteType}`, goodness: connection.goodness }]);
    if (connection.proto) {
      groups.push([{ text: connection.proto }]);
    }
  }
  if (connection.rttMs !== null) {
    groups.push([
      { text: "RTT ", goodness: rttGoodness, plain: true },
      { text: `${Math.round(connection.rttMs)} ms`, goodness: rttGoodness },
    ]);
  }
  return groups.flatMap((group, i) => (i === 0 ? group : [SEPARATOR, ...group]));
};
