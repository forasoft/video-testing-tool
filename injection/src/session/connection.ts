// Codecs and the selected candidate pair for the connection chip and line (PRD §9.3, §8.3).
import { ConnectionInfo } from "shared/protocol";
import { RtpStats, Snapshot } from "./extract";
import { pathGoodness } from "./goodness";
import { codecName, pathProtocol, pathType } from "./metrics";

const text = (value: unknown): string | null =>
  typeof value === "string" && value !== "" ? value : null;

// "turn:turn.example.com:443?transport=tcp" → "turn.example.com:443"
export const turnAddress = (url: string): string =>
  url.replace(/^turns?:/, "").replace(/\?.*$/, "");

// "srflx 203.0.113.17:51234 udp"; parts the browser does not report are left out.
export const describeCandidate = (candidate: RtpStats): string => {
  const address = text(candidate.address) ?? text(candidate.ip);
  const port = typeof candidate.port === "number" ? candidate.port : null;
  const endpoint = address && port !== null ? `${address}:${port}` : address;
  return [text(candidate.candidateType), endpoint, text(candidate.protocol)]
    .filter((part) => part !== null)
    .join(" ");
};

// Local: … / Remote: … / TURN: … (the TURN line only when this browser sends through a relay).
export const connectionTooltip = (local?: RtpStats, remote?: RtpStats): string[] => {
  const lines: string[] = [];
  if (local) {
    lines.push(`Local: ${describeCandidate(local)}`);
  }
  if (remote) {
    lines.push(`Remote: ${describeCandidate(remote)}`);
  }
  const url = text(local?.url);
  if (local?.candidateType === "relay" && url) {
    const relayProtocol = text(local.relayProtocol);
    lines.push(`TURN: ${turnAddress(url)}${relayProtocol ? ` (${relayProtocol})` : ""}`);
  }
  return lines;
};

// "srflx→relay · udp" — both candidate types and the protocol; null without a selected pair.
export const pathLabel = (connection: ConnectionInfo | null): string | null => {
  if (!connection || !connection.localType || !connection.remoteType) {
    return null;
  }
  const proto = connection.proto ? ` · ${connection.proto}` : "";
  return `${connection.localType}→${connection.remoteType}${proto}`;
};

export const connectionInfo = (
  { local, remote, videoCodec, audioCodec }: Snapshot,
  rttMs: number | null
): ConnectionInfo => {
  const type = pathType(local, remote) ?? null;
  const proto = pathProtocol(local) ?? null;
  const info: ConnectionInfo = {
    videoCodec: codecName(videoCodec) ?? null,
    audioCodec: codecName(audioCodec) ?? null,
    localType: text(local?.candidateType),
    remoteType: text(remote?.candidateType),
    type,
    proto,
    relayProtocol: text(local?.relayProtocol),
    rttMs,
    tooltip: connectionTooltip(local, remote),
  };
  if (type) {
    info.goodness = pathGoodness(type, proto);
  }
  return info;
};
