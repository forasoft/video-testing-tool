import { describe, expect, it } from "vitest";
import { ConnectionInfo } from "shared/protocol";
import { PathChanged } from "src/session/problems/pathChanged";
import { makeSamples, runDetectors, Segment, STEADY, Values } from "./makeSamples";

const HOST: Values = { pair_type: 0, pair_proto: 0, pair_changes: 1, rtt: 5 };

const connection = (localType: string, remoteType: string, proto: string, type = localType): ConnectionInfo => ({
  videoCodec: "VP8",
  audioCodec: "opus",
  localType,
  remoteType,
  type,
  proto,
  relayProtocol: localType === "relay" ? proto : null,
  rttMs: null,
  tooltip: [],
});

interface Options {
  segments: Segment[];
  // The path from `at` on.
  after: ConnectionInfo;
  at?: number;
  turn?: string | null;
  duration?: number;
}

const run = ({
  segments, after, at = 30, turn = null, duration = 60,
}: Options) => {
  const samples = makeSamples({ duration, base: { ...STEADY, ...HOST }, segments });
  let now = 0;
  const detector = new PathChanged(() => (now >= at ? turn : null));
  return runDetectors([detector], samples, {
    beforeSample: (t) => { now = t; },
    connection: (t) => (t >= at ? after : connection("host", "host", "udp")),
  });
};

// PRD §12.3, problem 4.
describe("Connection path changed", () => {
  it("opens when the selected pair changes to a relay and ends 3 s later", () => {
    const { problems, events } = run({
      segments: [{ from: 30, to: 61, values: { pair_type: 3, pair_proto: 1, pair_changes: 2, rtt: 12 } }],
      after: connection("relay", "relay", "tcp"),
      turn: "127.0.0.1:3478",
    });

    expect(events.events.filter((e) => e.kind === "path_change")).toEqual([expect.objectContaining({ t: 30, label: "Path → relay" })]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      type: "path_changed",
      title: "Connection path changed",
      category: "Network",
      severity: "warn",
      tStart: 30,
      tEnd: 33,
      oneLine: "→ relay · tcp, RTT 5 → 12 ms",
    });
    expect(problems[0].card.rows).toEqual([
      ["Path", "host→host · udp → relay→relay · tcp"],
      ["RTT", "5 → 12 ms"],
      ["Packet loss after", "0.0 %"],
      ["TURN", "127.0.0.1:3478"],
    ]);
    expect(problems[0].card.likelyCause).toBe("The direct path failed; media now goes through a TURN relay (tcp).");
    expect(problems[0].card.check).toBe("UDP blocked or Wi-Fi roaming? Expect +7 ms delay while on relay.");
    expect(problems[0].card.series.name).toBe("rtt");
  });

  it("opens for a non-relay pair once the RTT median of the 10 s after is 1.5 times the one before", () => {
    const { problems, sent } = run({
      segments: [{ from: 30, to: 61, values: { pair_type: 1, pair_changes: 2, rtt: 11 } }],
      after: connection("srflx", "srflx", "udp"),
    });

    expect(problems).toEqual([expect.objectContaining({ tStart: 30, tEnd: 33, oneLine: "→ srflx · udp, RTT 5 → 11 ms" })]);
    expect(problems[0].card.rows[3]).toEqual(["TURN", "—"]);
    expect(problems[0].card.likelyCause).toBe("The direct path failed; media now goes through a different route.");
    // Known only when the 10 s after the change are there.
    expect(sent[0]).toMatchObject({ tStart: 30, tEnd: 33, open: false });
  });

  it("is not a problem when a non-relay pair keeps the RTT", () => {
    const { problems } = run({
      segments: [{ from: 30, to: 61, values: { pair_type: 1, pair_changes: 2, rtt: 7 } }],
      after: connection("srflx", "srflx", "udp"),
    });

    expect(problems).toEqual([]);
  });

  it("does not take the first selected pair for a change", () => {
    const { problems } = run({
      segments: [{ from: 0, to: 61, values: { pair_type: 3, pair_changes: 1 } }],
      after: connection("relay", "relay", "udp"),
      at: 0,
    });

    expect(problems).toEqual([]);
  });

  it("makes one problem of changes within 3 s: the path before the first, after the last", () => {
    const { problems } = run({
      segments: [
        { from: 30, to: 32, values: { pair_type: 3, pair_changes: 2 } },
        { from: 32, to: 61, values: { pair_type: 3, pair_proto: 1, pair_changes: 3, rtt: 9 } },
      ],
      after: connection("relay", "relay", "tcp"),
    });

    expect(problems).toEqual([expect.objectContaining({ tStart: 30, tEnd: 35 })]);
    expect(problems[0].card.rows[0]).toEqual(["Path", "host→host · udp → relay→relay · tcp"]);
  });
});
