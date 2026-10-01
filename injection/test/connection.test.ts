import { describe, expect, it } from "vitest";
import { connectionInfo, connectionTooltip, describeCandidate, turnAddress } from "src/session/connection";
import { extract } from "src/session/extract";
import { findStat, loadSnapshots, patchStat, StatsList, toReport } from "./fixtures";

// Stand, TURN udp route: both sides are relay candidates of the stand's coturn.
const [stats] = loadSnapshots("receive-only-loss5.json");
const videoIn = findStat(stats, "inbound-rtp", "video");
const audioIn = findStat(stats, "inbound-rtp", "audio");
const local = findStat(stats, "local-candidate");
const remote = findStat(stats, "remote-candidate");
const selector = { videoTrackId: videoIn.trackIdentifier, audioTrackId: audioIn.trackIdentifier };

const info = (report: StatsList, rtt: number | null = 3) => connectionInfo(extract(toReport(report), selector), rtt);

describe("connection", () => {
  it("gives codecs, candidate types, protocol, RTT and the tooltip of the TURN udp route", () => {
    expect(info(stats)).toEqual({
      videoCodec: "VP8",
      audioCodec: "opus",
      localType: "relay",
      remoteType: "relay",
      type: "relay",
      proto: "udp",
      relayProtocol: "udp",
      rttMs: 3,
      tooltip: [
        "Local: relay 172.28.0.2:49184 udp",
        "Remote: relay 172.28.0.2:49194 udp",
        "TURN: 127.0.0.1:3479 (udp)",
      ],
      goodness: "moderate",
    });
  });

  it("rates relay over TCP bad and shows the TURN transport", () => {
    const report = patchStat(stats, local.id, { relayProtocol: "tcp", url: "turn:127.0.0.1:3478?transport=tcp" });
    const connection = info(report);

    expect(connection.proto).toBe("tcp");
    expect(connection.goodness).toBe("bad");
    expect(connection.tooltip[2]).toBe("TURN: 127.0.0.1:3478 (tcp)");
  });

  it("rates a direct host path good, without a TURN line", () => {
    const hostLocal: Record<string, unknown> = { candidateType: "host", relayProtocol: undefined, url: undefined, address: "192.168.1.20", port: 50000 };
    const report = patchStat(patchStat(stats, local.id, hostLocal), remote.id, { candidateType: "host", address: "192.168.1.21", port: 50001 });
    const connection = info(report);

    expect(connection.type).toBe("host");
    expect(connection.goodness).toBe("good");
    expect(connection.tooltip).toEqual(["Local: host 192.168.1.20:50000 udp", "Remote: host 192.168.1.21:50001 udp"]);
  });

  it("shows the remote type when only the remote side is relay", () => {
    const srflx: Record<string, unknown> = { candidateType: "srflx", relayProtocol: undefined, url: "stun:stun.example.com:3478" };
    const connection = info(patchStat(stats, local.id, srflx));

    expect(connection.localType).toBe("srflx");
    expect(connection.remoteType).toBe("relay");
    expect(connection.type).toBe("relay");
    expect(connection.proto).toBe("udp");
    expect(connection.goodness).toBe("moderate");
    expect(connection.tooltip).toHaveLength(2);
  });

  it("has no path, goodness or tooltip without a selected pair", () => {
    const withoutPair = stats.filter((stat) => stat.type !== "candidate-pair");
    const connection = info(withoutPair, null);

    expect(connection).toMatchObject({ type: null, localType: null, remoteType: null, proto: null, rttMs: null, tooltip: [] });
    expect(connection.goodness).toBeUndefined();
    expect(connection.videoCodec).toBe("VP8");
  });

  it("formats the TURN address and candidates the browser reports partly", () => {
    expect(turnAddress("turns:turn.example.com:443?transport=tcp")).toBe("turn.example.com:443");
    expect(turnAddress("turn:198.51.100.4:3478")).toBe("198.51.100.4:3478");
    expect(describeCandidate({ id: "c", timestamp: 0, type: "remote-candidate", candidateType: "host", protocol: "udp" }))
      .toBe("host udp");
    expect(describeCandidate({ id: "c", timestamp: 0, type: "local-candidate", candidateType: "srflx", ip: "203.0.113.17", port: 51234, protocol: "udp" }))
      .toBe("srflx 203.0.113.17:51234 udp");
    expect(connectionTooltip()).toEqual([]);
  });
});
