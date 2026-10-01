import { describe, expect, it } from "vitest";
import { ConnectionInfo } from "shared/protocol";
import {
  NO_VIDEO_S, SlowStart, StreamStart, streamOrigin,
} from "src/session/problems/slowStart";
import { makeSamples, runDetectors, STEADY } from "./makeSamples";

const RELAY: ConnectionInfo = {
  videoCodec: "VP8",
  audioCodec: "opus",
  localType: "relay",
  remoteType: "relay",
  type: "relay",
  proto: "udp",
  relayProtocol: "udp",
  rttMs: 5,
  tooltip: [],
};

// The stand's "No video for 6 s" with Auto-start: the session starts 0.58 s after setRemoteDescription,
// ICE is up 0.08 s after it, padding packets unmute the video track at 5.36 s, the first frame is at 6.23 s.
const NO_VIDEO_6: StreamStart = {
  origin: -0.58, iceConnected: -0.5, firstPacket: 4.78, firstFrame: 5.65,
};

// Feeds samples once a second; the first frame "arrives" when the session time reaches it. `connection: null` —
// no selected pair.
const run = (start: StreamStart, { duration = 30, connection = RELAY }: { duration?: number; connection?: ConnectionInfo | null } = {}) => {
  let now = 0;
  const detector = new SlowStart(() => ({
    ...start,
    firstFrame: start.firstFrame !== null && start.firstFrame <= now ? start.firstFrame : null,
    firstPacket: start.firstPacket !== null && start.firstPacket <= now ? start.firstPacket : null,
    iceConnected: start.iceConnected !== null && start.iceConnected <= now ? start.iceConnected : null,
  }));
  return runDetectors([detector], makeSamples({ duration, base: STEADY }), {
    beforeSample: (t) => { now = t; },
    connection: () => connection ?? undefined,
  });
};

// PRD §12.3, problem 10.
describe("Slow start", () => {
  it("opens 4 s after the stream began without a frame and ends at the first frame", () => {
    const { problems, sent } = run(NO_VIDEO_6);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      type: "slow_start",
      title: "Slow start",
      category: "Network",
      severity: "warn",
      tStart: 0,
      tEnd: 5.65,
      open: false,
      oneLine: "first frame after 6.2 s",
    });
    expect(problems[0].card.rows).toEqual([
      ["First frame", "6.23 s"],
      ["ICE connected at", "0.08 s"],
      ["First packet at", "5.36 s"],
      ["Path", "relay→relay · udp"],
    ]);
    expect(problems[0].card.likelyCause).toBe("Connected in 0.08 s but the first frame came 6.15 s later — waiting for a keyframe from the sender.");
    expect(problems[0].card.check).toBe("TURN configuration and UDP; keyframe request handling on the sender/SFU.");
    expect(problems[0].card.series.name).toBe("v_bitrate");
    // While there is no frame yet.
    expect(sent[0]).toMatchObject({ open: true, oneLine: "first frame after 4.6 s", severity: "warn" });
    expect(sent[0].card.rows[0]).toEqual(["First frame", "—"]);
    expect(sent[0].card.likelyCause).toBe("Connected in 0.08 s but no frame came in 4.50 s — waiting for a keyframe from the sender.");
  });

  it("is severe after 8 s", () => {
    const { problems, sent } = run({ ...NO_VIDEO_6, firstFrame: 9.7, firstPacket: 9.1 });

    expect(problems[0]).toMatchObject({ tStart: 0, tEnd: 9.7, severity: "severe", oneLine: "first frame after 10.3 s" });
    expect(sent.map((m) => m.severity)).toContain("warn");
  });

  it("closes as no video when no frame came in 15 s", () => {
    const { problems } = run({ ...NO_VIDEO_6, firstFrame: null, firstPacket: null });

    expect(problems[0]).toMatchObject({ tStart: 0, tEnd: NO_VIDEO_S - 0.58, open: false, severity: "severe", oneLine: "no video in 15 s" });
    expect(problems[0].card.rows.slice(0, 3)).toEqual([
      ["First frame", "none in 15 s"],
      ["ICE connected at", "0.08 s"],
      ["First packet at", "—"],
    ]);
    expect(problems[0].card.likelyCause).toBe("Connected in 0.08 s but no frame came in 14.92 s — waiting for a keyframe from the sender.");
  });

  it("names a slow ICE, through a relay, or one that never connected", () => {
    const slowIce = run({ ...NO_VIDEO_6, iceConnected: 4.5, firstPacket: 4.6, firstFrame: 5 });
    expect(slowIce.problems[0].card.likelyCause).toBe("ICE took 5.08 s to connect through a relay.");

    const direct = run({ ...NO_VIDEO_6, iceConnected: 4.5, firstPacket: 4.6, firstFrame: 5 }, { connection: { ...RELAY, localType: "host", remoteType: "host", type: "host" } });
    expect(direct.problems[0].card.likelyCause).toBe("ICE took 5.08 s to connect.");

    const never = run({ ...NO_VIDEO_6, iceConnected: null, firstPacket: null, firstFrame: null }, { connection: null });
    expect(never.problems[0].card.likelyCause).toBe("ICE did not connect in 15.00 s.");
    expect(never.problems[0].card.rows[3]).toEqual(["Path", "—"]);
  });

  it("is no problem when the first frame came within 4 s, or when the stream began before the session", () => {
    expect(run({ ...NO_VIDEO_6, firstFrame: 3.3 }).problems).toEqual([]);
    expect(run({ ...NO_VIDEO_6, origin: null, firstFrame: null }).problems).toEqual([]);
  });
});

describe("streamOrigin", () => {
  it("counts from setRemoteDescription when the session caught the start, else from the session start", () => {
    // HAVE_NOTHING: no frame yet.
    expect(streamOrigin(-0.58, 0)).toBe(-0.58);
    // The description was set too long ago: the session start, as the PRD says.
    expect(streamOrigin(-20, 0)).toBe(0);
    expect(streamOrigin(null, 1)).toBe(0);
    // HAVE_CURRENT_DATA and more: the stream already showed a frame.
    expect(streamOrigin(-0.58, 2)).toBeNull();
    expect(streamOrigin(-300, 4)).toBeNull();
  });
});
