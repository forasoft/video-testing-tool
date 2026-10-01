import { describe, expect, it, vi } from "vitest";
import { ConnectionInfo } from "shared/protocol";
import { SampleBuffer } from "src/session/buffer";
import { EventLog } from "src/session/events";
import { RtpStats } from "src/session/extract";
import { IceSignal, ProblemEngine } from "src/session/problems/engine";
import { lastPacketTime, NOT_RECOVERED_S, Reconnection } from "src/session/problems/reconnection";
import { makeSamples, STEADY } from "./makeSamples";

const RELAY: ConnectionInfo = {
  videoCodec: "VP8",
  audioCodec: "opus",
  localType: "relay",
  remoteType: "relay",
  type: "relay",
  proto: "udp",
  relayProtocol: "udp",
  rttMs: 3,
  tooltip: [],
  goodness: "moderate",
};

const ice = (t: number, state: RTCIceConnectionState, lastPacketT: number | null = null): IceSignal =>
  ({ kind: "ice", t, state, lastPacketT });

// The session's order: signals as they come, one sample a second with the connection seen then.
const run = (signals: IceSignal[], duration: number, connectionAt: (t: number) => ConnectionInfo | undefined = () => RELAY) => {
  const buffer = new SampleBuffer();
  const events = new EventLog();
  const onEnd = vi.fn();
  const engine = new ProblemEngine({ buffer, events, detectors: [new Reconnection()], onEnd });
  const pending = [...signals];
  makeSamples({ duration, base: STEADY }).forEach((sample) => {
    while (pending.length && pending[0].t <= (sample.t as number)) {
      engine.signal(pending.shift() as IceSignal);
    }
    buffer.push(sample);
    engine.onSample(sample, connectionAt(sample.t as number));
  });
  return { engine, events, onEnd, problems: engine.list() };
};

describe("Reconnection", () => {
  it("starts with the last packet before ICE noticed the drop and ends when ICE is connected again", () => {
    // Blackout from 10 s: ICE turns disconnected 5.3 s later and connected at 18.1 s.
    const { problems, events } = run([ice(0, "connected"), ice(15.3, "disconnected", 10), ice(18.1, "connected", 10)], 40);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      id: 1,
      type: "reconnection",
      title: "Reconnection",
      category: "Network",
      severity: "severe",
      tStart: 10,
      tEnd: 18.1,
      open: false,
      oneLine: "8.1 s",
    });
    expect(problems[0].card.rows).toEqual([
      ["Down for", "8.1 s"],
      ["ICE state", "connected → disconnected → connected"],
      ["Path after", "relay→relay · udp"],
    ]);
    expect(problems[0].card.likelyCause).toBe("The connection to the sender was lost for 8.1 s.");
    expect(problems[0].card.check).toBe(
      "Network drop on this machine (Wi-Fi, VPN, sleep) or on the sender's; if all participants reconnected at once — the SFU."
    );
    expect(problems[0].card.series.name).toBe("v_bitrate");
    expect(events.events.map(({ t, kind, label, tone }) => ({ t, kind, label, tone }))).toEqual([
      { t: 18.1, kind: "reconnect", label: "Reconnected", tone: "green" },
    ]);
  });

  it("starts at the ICE change when the last packet time is unknown", () => {
    const { problems } = run([ice(0, "connected"), ice(15.3, "disconnected"), ice(18.1, "completed")], 30);

    expect(problems[0]).toMatchObject({ tStart: 15.3, tEnd: 18.1, oneLine: "2.8 s" });
  });

  it("shows the worst ICE state and the duration so far while it lasts", () => {
    const { engine } = run([ice(0, "connected"), ice(12, "disconnected", 7), ice(20, "failed", 7)], 25);

    expect(engine.list()[0]).toMatchObject({ open: true, tEnd: null, oneLine: "18.0 s" });
    expect(engine.list()[0].card.rows.slice(0, 2)).toEqual([["Down for", "18.0 s"], ["ICE state", "connected → failed"]]);
  });

  it("closes as not recovered after 30 s and ends the session", () => {
    const { problems, onEnd, events } = run([ice(0, "connected"), ice(5, "disconnected", 0.5), ice(15, "failed", 0.5)], 45);

    expect(problems[0]).toMatchObject({ tStart: 0.5, tEnd: 0.5 + NOT_RECOVERED_S, open: false, oneLine: "30.0 s, not recovered" });
    expect(problems[0].card.rows).toEqual([
      ["Down for", "30.0 s"],
      ["ICE state", "connected → failed → not recovered"],
      ["Path after", "—"],
    ]);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(onEnd).toHaveBeenCalledWith("not recovered");
    expect(events.events).toEqual([]);
  });

  it("ignores ICE trouble before the connection was ever up", () => {
    const { problems } = run([ice(0, "checking"), ice(3, "disconnected"), ice(6, "connected")], 20);

    expect(problems).toEqual([]);
  });

  it("drops a flap shorter than 1 s, with no Reconnected event", () => {
    const { problems, events } = run([ice(0, "connected"), ice(10, "disconnected"), ice(10.4, "connected")], 20);

    expect(problems).toEqual([]);
    expect(events.events).toEqual([]);
  });

  it("takes the path after from the first sample that has a selected pair again", () => {
    const tcp = { ...RELAY, proto: "tcp", relayProtocol: "tcp" };
    const connectionAt = (t: number) => (t < 19 ? { ...RELAY, localType: null, remoteType: null, type: null } : tcp);
    const { problems } = run([ice(0, "connected"), ice(15, "disconnected", 10), ice(18.2, "connected", 10)], 30, connectionAt);

    expect(problems[0].card.rows[2]).toEqual(["Path after", "relay→relay · tcp"]);
  });
});

describe("lastPacketTime", () => {
  const pair = (timestamp: number, lastPacketReceivedTimestamp?: number) =>
    ({ id: "p", type: "candidate-pair", timestamp, lastPacketReceivedTimestamp }) as RtpStats;

  it("turns the pair's last packet time into seconds from the session start", () => {
    // Sample at 12.0 s; the last packet came 4 979 ms before the report.
    expect(lastPacketTime(pair(1790260865062, 1790260860083), 12)).toBe(7.021);
  });

  it("is null without the counter or with an impossible one", () => {
    expect(lastPacketTime(undefined, 5)).toBeNull();
    expect(lastPacketTime(pair(1000), 5)).toBeNull();
    expect(lastPacketTime(pair(1000, 0), 5)).toBeNull();
    expect(lastPacketTime(pair(1000, 2000), 5)).toBeNull();
  });
});
