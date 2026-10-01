import { beforeEach, describe, expect, it, vi } from "vitest";
import { lossGoodness } from "src/session/goodness";
import { emptySample } from "src/session/metrics";
import {
  intervalLoss, OtherStreams, streamRow, streamValues, valuesGoodness, watchedFreezes, worstGoodness,
} from "src/session/streams";
import { numberTrack, pageTracks, trackNumber } from "src/wrappers/wrap-web-rtc/tracks";
import { findStat, loadSnapshots, patchStat, StatsList, toReport } from "./fixtures";

// A receive-only call with 5 % loss, one report a second.
const snapshots = loadSnapshots("receive-only-loss5.json");
const inbound = (i: number) => findStat(snapshots[i], "inbound-rtp", "video");
const trackId = inbound(0).trackIdentifier as string;

const fakeTrack = (id: string, kind = "video") => ({ id, kind, readyState: "live" }) as unknown as MediaStreamTrack;

const fakePeer = (reports: StatsList[] = [], mids: [MediaStreamTrack, string][] = []) => {
  let i = 0;
  return {
    signalingState: "stable",
    getStats: vi.fn(() => Promise.resolve(toReport(reports[Math.min(i++, reports.length - 1)] ?? []))),
    getTransceivers: () => mids.map(([track, mid]) => ({ mid, receiver: { track } })),
  };
};

// Other streams, PRD §13.4.
describe("stream values", () => {
  it("bitrate and loss of the interval between two polls, freezes of the time watched", () => {
    const first = inbound(0);
    const cur = inbound(5);
    const v = streamValues(cur, first, first);

    expect(v.w).toBe(960);
    expect(v.h).toBe(540);
    const ms = cur.timestamp - first.timestamp;
    expect(v.bitrate).toBeCloseTo((((cur.bytesReceived as number) - (first.bytesReceived as number)) * 8) / ms, 6);
    const lost = (cur.packetsLost as number) - (first.packetsLost as number);
    const received = (cur.packetsReceived as number) - (first.packetsReceived as number);
    expect(v.loss).toBeCloseTo((lost / (lost + received)) * 100, 6);
    expect(v.loss).toBeGreaterThan(3);
    expect(v.freezes).toBe(0);
  });

  it("counts freezes as totalFreezesDuration Δ over the seconds since the first poll", () => {
    const first = { ...inbound(0), timestamp: 0, totalFreezesDuration: 1.5 };
    const cur = { ...inbound(5), timestamp: 20000, totalFreezesDuration: 2.5 };

    expect(watchedFreezes(cur, first)).toBe(5);
    expect(watchedFreezes(cur, cur)).toBeNull();
    expect(watchedFreezes(cur)).toBeNull();
  });

  it("has no bitrate, loss or freezes on the first poll or after the SSRC changed", () => {
    const cur = inbound(5);
    const other = { ...inbound(0), ssrc: 1 };

    expect(streamValues(cur)).toEqual({
      w: 960, h: 540, bitrate: null, loss: null, freezes: null,
    });
    expect(streamValues(cur, other, other)).toMatchObject({ bitrate: null, loss: null, freezes: null });
  });

  it("has no loss without packets in the interval and never a negative one", () => {
    const prev = inbound(0);

    expect(intervalLoss(prev, prev)).toBeNull();
    // packetsLost may go down when late packets arrive.
    expect(intervalLoss({ ...inbound(5), packetsLost: (prev.packetsLost as number) - 3 }, prev)).toBe(0);
  });
});

describe("stream grade", () => {
  it("is the worst grade of the row", () => {
    expect(worstGoodness([])).toBeUndefined();
    expect(worstGoodness([undefined, "good", "bad", "moderate"])).toBe("bad");
    expect(worstGoodness(["good", "moderate", undefined])).toBe("moderate");
  });

  it("grades bitrate by the frame height, loss and freezes; the resolution only against a <video> that shows it", () => {
    const values = {
      w: 640, h: 360, bitrate: 900, loss: 0.2, freezes: 0,
    };

    expect(valuesGoodness(values, null)).toBe("good");
    // 5 % loss is the top of the yellow zone, above it red (§7).
    expect(valuesGoodness({ ...values, loss: 5 }, null)).toBe("moderate");
    expect(valuesGoodness({ ...values, loss: 5.3 }, null)).toBe("bad");
    // < 480p needs 700 kbps.
    expect(valuesGoodness({ ...values, bitrate: 612 }, null)).toBe("moderate");
    expect(valuesGoodness(values, { clientWidth: 1280, clientHeight: 720 })).toBe("moderate");
    expect(valuesGoodness({
      w: null, h: null, bitrate: null, loss: null, freezes: null,
    }, null)).toBeUndefined();
  });

  it("names the row Stream {N} with the track and mid in its tooltip", () => {
    expect(streamRow({
      n: 2, trackId: "abc", mid: null, selected: false, values: streamValues(inbound(0)),
    })).toEqual({
      id: "abc", name: "Stream 2", selected: false, w: 960, h: 540, bitrate: null, loss: null, freezes: null, tooltip: "track abc · mid —",
    });
  });
});

describe("OtherStreams", () => {
  const selectedTrack = fakeTrack("selected");
  const sample = {
    ...emptySample(), t: 5, v_w: 1280, v_h: 720, v_bitrate: 2100, v_loss: 0.21, v_freeze_pct: 2.1,
  };

  it("polls the other connections once per poll and the selected one not at all: its report is the session's", async () => {
    const selectedPeer = fakePeer();
    const other = fakeTrack(trackId);
    const otherPeer = fakePeer([snapshots[0], snapshots[5]], [[other, "0"]]);
    const streams = new OtherStreams({
      peer: selectedPeer as unknown as RTCPeerConnection,
      track: selectedTrack,
      tracks: () => [
        { track: selectedTrack, peer: selectedPeer as unknown as RTCPeerConnection, n: 1 },
        { track: other, peer: otherPeer as unknown as RTCPeerConnection, n: 2 },
      ],
      element: () => null,
    });

    const first = await streams.poll(toReport([]), sample, { bitrate: "good", loss: "good", freezes: "moderate" });
    const second = await streams.poll(toReport([]), sample, { bitrate: "good", loss: "good", freezes: "moderate" });

    expect(selectedPeer.getStats).not.toHaveBeenCalled();
    expect(otherPeer.getStats).toHaveBeenCalledTimes(2);
    // The selected stream: its tiles' values and the worst of their grades.
    expect(first[0]).toEqual({
      id: "selected", name: "Stream 1", selected: true, w: 1280, h: 720, bitrate: 2100, loss: 0.21, freezes: 2.1, goodness: "moderate", tooltip: "track selected · mid —",
    });
    expect(first[1]).toMatchObject({
      name: "Stream 2", selected: false, w: 960, h: 540, bitrate: null, loss: null, tooltip: `track ${trackId} · mid 0`,
    });
    expect(first[1].goodness).toBeUndefined();
    expect(second[1].bitrate).toBeGreaterThan(1000);
    expect(second[1].loss).toBeGreaterThan(3);
    expect(second[1].freezes).toBe(0);
    // The bitrate is good for 540p and there are no freezes: the loss (5.x %) gives the dot its color.
    expect(second[1].goodness).toBe(lossGoodness(second[1].loss as number));
    expect(streams.rows).toBe(second);
  });

  it("takes another video track of the selected connection from the session's report", async () => {
    const selectedPeer = fakePeer();
    const other = fakeTrack(trackId);
    const streams = new OtherStreams({
      peer: selectedPeer as unknown as RTCPeerConnection,
      track: selectedTrack,
      tracks: () => [
        { track: selectedTrack, peer: selectedPeer as unknown as RTCPeerConnection, n: 1 },
        { track: other, peer: selectedPeer as unknown as RTCPeerConnection, n: 3 },
      ],
      element: () => ({ clientWidth: 480, clientHeight: 270 }),
    });

    await streams.poll(toReport(snapshots[0]), sample, {});
    const rows = await streams.poll(toReport(snapshots[5]), sample, {});

    expect(selectedPeer.getStats).not.toHaveBeenCalled();
    expect(rows.map((row) => row.name)).toEqual(["Stream 1", "Stream 3"]);
    expect(rows[1].bitrate).toBeGreaterThan(1000);
    // The selected row without grades of its own has a gray dot.
    expect(rows[0].goodness).toBeUndefined();
  });

  it("is empty without other streams: a track that received nothing or a connection whose getStats fails is left out", async () => {
    const selectedPeer = fakePeer();
    const silent = fakeTrack("silent");
    const failing = fakeTrack(trackId);
    const failingPeer = { ...fakePeer(), getStats: vi.fn(() => Promise.reject(new Error("closed"))) };
    const streams = new OtherStreams({
      peer: selectedPeer as unknown as RTCPeerConnection,
      track: selectedTrack,
      tracks: () => [
        { track: selectedTrack, peer: selectedPeer as unknown as RTCPeerConnection, n: 1 },
        { track: silent, peer: fakePeer([patchStat(snapshots[0], inbound(0).id, { trackIdentifier: "another" })]) as unknown as RTCPeerConnection, n: 2 },
        { track: failing, peer: failingPeer as unknown as RTCPeerConnection, n: 3 },
      ],
      element: () => null,
    });

    expect(await streams.poll(toReport([]), sample, {})).toEqual([]);
    expect(streams.rows).toEqual([]);
  });
});

describe("page tracks", () => {
  const peer = { signalingState: "stable" } as unknown as RTCPeerConnection;

  beforeEach(() => {
    pageTracks().forEach(({ track }) => {
      (track as unknown as { readyState: string }).readyState = "ended";
    });
  });

  it("numbers received video tracks in the order they appeared, once each, and forgets the ended ones", () => {
    const a = fakeTrack("a");
    const audio = fakeTrack("mic", "audio");
    const b = fakeTrack("b");
    const closedPeer = { signalingState: "stable" } as unknown as RTCPeerConnection;
    const c = fakeTrack("c");

    numberTrack(peer, a);
    numberTrack(peer, audio);
    numberTrack(peer, b);
    numberTrack(peer, a);
    numberTrack(closedPeer, c);
    const [n] = [trackNumber(a)];

    expect(trackNumber(b)).toBe((n as number) + 1);
    expect(trackNumber(audio)).toBeNull();
    expect(pageTracks().map(({ track }) => track.id)).toEqual(["a", "b", "c"]);

    (b as unknown as { readyState: string }).readyState = "ended";
    (closedPeer as unknown as { signalingState: string }).signalingState = "closed";
    expect(pageTracks().map(({ track }) => track.id)).toEqual(["a"]);
    // A number is not given again.
    const d = fakeTrack("d");
    numberTrack(peer, d);
    expect(trackNumber(d)).toBe((n as number) + 3);
  });
});
