import { describe, expect, it } from "vitest";
import { createSelector, extract } from "src/session/extract";
import { findStat, loadSnapshots, patchStat, toReport } from "./fixtures";

const [stats] = loadSnapshots("receive-only-loss5.json");
const videoIn = findStat(stats, "inbound-rtp", "video");
const audioIn = findStat(stats, "inbound-rtp", "audio");
const transport = findStat(stats, "transport");
const selector = {
  videoTrackId: videoIn.trackIdentifier,
  audioTrackId: audioIn.trackIdentifier,
  videoMid: videoIn.mid,
  audioMid: audioIn.mid,
};

describe("extract", () => {
  it("picks the selected stream's inbound reports, codecs, pair and candidates", () => {
    const snapshot = extract(toReport(stats), selector);

    expect(snapshot.video?.id).toBe(videoIn.id);
    expect(snapshot.audio?.id).toBe(audioIn.id);
    expect(snapshot.videoCodec?.mimeType).toBe("video/VP8");
    expect(snapshot.audioCodec?.mimeType).toBe("audio/opus");
    expect(snapshot.pair?.id).toBe(transport.selectedCandidatePairId);
    expect(snapshot.local?.candidateType).toBe("relay");
    expect(snapshot.remote?.candidateType).toBe("relay");
  });

  it("ignores inbound reports of other tracks", () => {
    const other = { ...videoIn, id: "other", trackIdentifier: "other-track", ssrc: 1, mid: "9" };
    const snapshot = extract(toReport([other, ...stats]), selector);

    expect(snapshot.video?.id).toBe(videoIn.id);
  });

  it("falls back to kind + mid without trackIdentifier", () => {
    const withoutIds = stats.map((stat) => {
      const copy = { ...stat };
      delete copy.trackIdentifier;
      return copy;
    });
    const snapshot = extract(toReport(withoutIds), selector);

    expect(snapshot.video?.id).toBe(videoIn.id);
    expect(snapshot.audio?.id).toBe(audioIn.id);
  });

  it("falls back to the nominated succeeded pair without selectedCandidatePairId", () => {
    const report = patchStat(stats, transport.id, { selectedCandidatePairId: undefined });
    const snapshot = extract(toReport(report), selector);

    expect(snapshot.pair?.id).toBe(transport.selectedCandidatePairId);
    expect(snapshot.pair?.nominated).toBe(true);
  });

  it("returns no video when the track is not in the report", () => {
    const snapshot = extract(toReport(stats), { ...selector, videoTrackId: "missing", videoMid: null });

    expect(snapshot.video).toBeUndefined();
    expect(snapshot.audio?.id).toBe(audioIn.id);
  });

  it("picks the outgoing video and the source it is captured from", () => {
    expect(extract(toReport(stats), selector)).toMatchObject({ outbound: [], outboundSource: undefined });

    const [twoWay] = loadSnapshots("two-way-cpu.json");
    const out = findStat(twoWay, "outbound-rtp", "video");
    const snapshot = extract(toReport(twoWay), selector);

    expect(snapshot.outbound?.map((layer) => layer.id)).toEqual([out.id]);
    expect(snapshot.outboundSource).toMatchObject({ id: out.mediaSourceId, type: "media-source", width: 640, height: 360 });
  });
});

describe("createSelector", () => {
  it("takes ids of the element's tracks and mids of their transceivers", () => {
    const video = { id: "v1", kind: "video" } as MediaStreamTrack;
    const audio = { id: "a1", kind: "audio" } as MediaStreamTrack;
    const pc = {
      getTransceivers: () => [
        { mid: "0", receiver: { track: video } },
        { mid: "1", receiver: { track: audio } },
      ],
    } as unknown as RTCPeerConnection;

    expect(createSelector(pc, [video, audio])).toEqual({
      videoTrackId: "v1",
      videoMid: "0",
      audioTrackId: "a1",
      audioMid: "1",
    });
  });
});
