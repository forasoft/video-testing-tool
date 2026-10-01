import { describe, expect, it } from "vitest";
import { ConnectionInfo } from "shared/protocol";
import { connectionLine, verdictChip } from "../../popup/src/components/expanded/verdict";

const connection = (patch: Partial<ConnectionInfo> = {}): ConnectionInfo => ({
  videoCodec: "H264",
  audioCodec: "opus",
  localType: "srflx",
  remoteType: "relay",
  type: "relay",
  proto: "udp",
  relayProtocol: null,
  rttMs: 91.6,
  tooltip: [],
  goodness: "moderate",
  ...patch,
});

const text = (parts: { text: string }[]) => parts.map((p) => p.text).join("");

// Verdict chip of the Timeline, PRD §11.1.
describe("verdict chip", () => {
  it("is OK green without problems and before the first sample", () => {
    expect(verdictChip({ level: "OK", degradedS: 0, worst: null, text: "No problems in 1:12" }, "live")).toEqual({ text: "OK", tone: "green" });
    expect(verdictChip(undefined, undefined)).toEqual({ text: "OK", tone: "green" });
  });

  it("shows Σ of the problems with one decimal, yellow for Degraded and red for Severe", () => {
    expect(verdictChip({ level: "Degraded", degradedS: 9.7, worst: 1, text: "" }, "live")).toEqual({ text: "Degraded 9.7 s", tone: "yellow" });
    expect(verdictChip({ level: "Severe", degradedS: 33, worst: 2, text: "" }, "stopped")).toEqual({ text: "Severe 33.0 s", tone: "red" });
  });

  it("is Disconnected red once the stream is gone, whatever the problems", () => {
    expect(verdictChip({ level: "Degraded", degradedS: 9.7, worst: 1, text: "" }, "disconnected")).toEqual({ text: "Disconnected", tone: "red" });
  });
});

// Connection line of the Expanded header, PRD §8.3.
describe("connection line", () => {
  it("joins codecs, candidate types, protocol and RTT; colors →remote and RTT", () => {
    const parts = connectionLine(connection(), "good");

    expect(text(parts)).toBe("H264 · opus · srflx→relay · udp · RTT 92 ms");
    expect(parts.filter((p) => p.goodness)).toEqual([
      { text: "→relay", goodness: "moderate" },
      { text: "RTT ", goodness: "good", plain: true },
      { text: "92 ms", goodness: "good" },
    ]);
    // Values are monospace; separators and the RTT label are not.
    expect(parts.filter((p) => !p.plain).map((p) => p.text)).toEqual(["H264", "opus", "srflx", "→relay", "udp", "92 ms"]);
  });

  it("leaves out the path and RTT the browser does not report", () => {
    const parts = connectionLine(connection({
      localType: null, remoteType: null, proto: null, rttMs: null, goodness: undefined, audioCodec: null,
    }));

    expect(text(parts)).toBe("H264 · —");
  });

  it("keeps the path without a protocol", () => {
    expect(text(connectionLine(connection({ proto: null, rttMs: 5 }), "good"))).toBe("H264 · opus · srflx→relay · RTT 5 ms");
  });
});
