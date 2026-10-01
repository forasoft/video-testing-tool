import { describe, expect, it } from "vitest";
import {
  CANDIDATE_TYPES, ENCODER_KINDS, PROTOCOLS, QUALITY_LIMITS, VIDEO_CODECS,
} from "shared/constants/sampleFields";
import { ElementInfo, extract, RtpStats, Snapshot } from "src/session/extract";
import {
  bitrateKbps,
  delta,
  Metrics,
  outgoing,
  pathProtocol,
  pathType,
  pushLoss,
  renderDelay,
  WindowPct,
} from "src/session/metrics";
import { findStat, loadSnapshots, patchStat, StatsList, toReport } from "./fixtures";

const snapshots = loadSnapshots("receive-only-loss5.json");
const videoIn = (stats: StatsList) => findStat(stats, "inbound-rtp", "video");
const audioIn = (stats: StatsList) => findStat(stats, "inbound-rtp", "audio");
const pairOf = (stats: StatsList) => findStat(stats, "candidate-pair");
const selector = {
  videoTrackId: videoIn(snapshots[0]).trackIdentifier,
  audioTrackId: audioIn(snapshots[0]).trackIdentifier,
};

const element = (droppedFrames: number | null = 0): ElementInfo => ({
  videoWidth: 1280,
  videoHeight: 720,
  clientWidth: 640,
  clientHeight: 360,
  droppedFrames,
  readyState: 4,
});

const snap = (stats: StatsList, el?: ElementInfo): Snapshot => ({
  ...extract(toReport(stats), selector),
  element: el,
});

const run = (reports: StatsList[]) => {
  const metrics = new Metrics();
  return reports.map((stats, i) => metrics.next(snap(stats, element()), i));
};

const n = (stat: RtpStats, key: string) => stat[key] as number;
const d = (key: string, a: RtpStats, b: RtpStats) => n(b, key) - n(a, key);

describe("delta", () => {
  it("is null when a counter goes down or is missing", () => {
    expect(delta({ id: "a", type: "x", timestamp: 2, c: 10 }, { id: "a", type: "x", timestamp: 1, c: 4 }, "c")).toBe(6);
    expect(delta({ id: "a", type: "x", timestamp: 2, c: 3 }, { id: "a", type: "x", timestamp: 1, c: 4 }, "c")).toBeNull();
    expect(delta({ id: "a", type: "x", timestamp: 2 }, { id: "a", type: "x", timestamp: 1, c: 4 }, "c")).toBeNull();
  });
});

describe("bitrate", () => {
  it("is bytesReceived Δ × 8 / Δt in kbps", () => {
    const [a, b] = snapshots;
    const expected = (d("bytesReceived", videoIn(a), videoIn(b)) * 8) / (videoIn(b).timestamp - videoIn(a).timestamp);

    expect(bitrateKbps(videoIn(b), videoIn(a))).toBeCloseTo(expected, 6);
    expect(expected).toBeGreaterThan(300);
  });

  it("has no value in the first sample and a value for audio too", () => {
    const [first, second] = run(snapshots.slice(0, 2));

    expect(first.v_bitrate).toBeNull();
    expect(first.a_bitrate).toBeNull();
    expect(second.v_bitrate).toBeGreaterThan(300);
    expect(second.a_bitrate).toBeGreaterThan(10);
    expect(second.a_bitrate).toBeLessThan(100);
  });
});

describe("packet loss", () => {
  it("is lost / (lost + received) over the last 5 samples on a receive-only connection", () => {
    // The receiver sends no media: the old formula divided by packetsSent of RTCP and got ~0.5 %.
    expect(snapshots[0].some((stat) => stat.type === "outbound-rtp")).toBe(false);

    const samples = run(snapshots);
    const last = snapshots.length - 1;
    const first = last - 5;
    const lost = d("packetsLost", videoIn(snapshots[first]), videoIn(snapshots[last]));
    const received = d("packetsReceived", videoIn(snapshots[first]), videoIn(snapshots[last]));

    expect(samples[last].v_loss).toBeCloseTo((lost / (lost + received)) * 100, 6);
    // Network preset Loss 5 %: 5 samples of ~130 packets each.
    expect(samples[last].v_loss).toBeGreaterThan(2);
    expect(samples[last].v_loss).toBeLessThan(9);
    expect(samples[last].a_loss).toBeGreaterThan(1);
  });

  it("keeps a small negative Δ of packetsLost (late packets) inside the window", () => {
    const window = new WindowPct();
    const at = (packetsLost: number, packetsReceived: number): RtpStats =>
      ({ id: "v", type: "inbound-rtp", timestamp: 0, ssrc: 1, packetsLost, packetsReceived });

    expect(pushLoss(window, at(10, 100), at(0, 0))).toBeCloseTo((10 / 110) * 100, 6);
    expect(pushLoss(window, at(8, 200), at(10, 100))).toBeCloseTo((8 / 208) * 100, 6);
  });
});

describe("new SSRC", () => {
  it("gives null deltas and restarts the loss window", () => {
    const [a, b, c, e] = snapshots;
    const video = videoIn(c);
    // The sender restarted the stream: new SSRC, counters start from zero.
    const restarted = patchStat(c, video.id, { ssrc: 42, bytesReceived: 1000, packetsReceived: 10, packetsLost: 0 });
    const next = patchStat(e, videoIn(e).id, {
      ssrc: 42,
      bytesReceived: 1000 + 125000,
      packetsReceived: 110,
      packetsLost: 5,
      timestamp: videoIn(restarted).timestamp + 1000,
    });

    const samples = run([a, b, restarted, next]);

    expect(samples[1].v_loss).not.toBeNull();
    expect(samples[2].v_bitrate).toBeNull();
    expect(samples[2].v_loss).toBeNull();
    expect(samples[2].v_jb).toBeNull();
    expect(samples[3].v_bitrate).toBeCloseTo(1000, 6);
    expect(samples[3].v_loss).toBeCloseTo((5 / 105) * 100, 6);
  });

  it("treats a counter that went down with the same SSRC as a restart", () => {
    const [a, b] = snapshots;
    const lower = patchStat(b, videoIn(b).id, { bytesReceived: 5, packetsReceived: 1 });

    const samples = run([a, lower]);

    expect(samples[1].v_bitrate).toBeNull();
    expect(samples[1].v_loss).toBeNull();
  });
});

describe("receive metrics (PRD §7)", () => {
  const [a, b] = snapshots.slice(3, 5);
  const va = videoIn(a);
  const vb = videoIn(b);
  const aa = audioIn(a);
  const ab = audioIn(b);
  const seconds = (vb.timestamp - va.timestamp) / 1000;
  const metrics = new Metrics();
  metrics.next(snap(a, element(10)), 0);
  const s = metrics.next(snap(b, element(13)), 1);

  it("frame rates are frames Δ / Δt", () => {
    expect(s.v_fps_dec).toBeCloseTo(d("framesDecoded", va, vb) / seconds, 6);
    expect(s.v_fps_recv).toBeCloseTo(d("framesReceived", va, vb) / seconds, 6);
    expect(s.v_fps_dec).toBeGreaterThan(20);
  });

  it("resolution is the element's videoWidth × videoHeight", () => {
    expect([s.v_w, s.v_h]).toEqual([1280, 720]);
    const noFrames = new Metrics().next(snap(b, { ...element(), videoWidth: 0, videoHeight: 0 }), 0);
    expect([noFrames.v_w, noFrames.v_h]).toEqual([null, null]);
  });

  it("jitter is in milliseconds", () => {
    expect(s.v_jitter).toBeCloseTo(n(vb, "jitter") * 1000, 6);
    expect(s.a_jitter).toBeCloseTo(n(ab, "jitter") * 1000, 6);
  });

  it("NACK, PLI, discarded packets and decoder freezes are counter Δ", () => {
    expect(s.v_nack).toBe(d("nackCount", va, vb));
    expect(s.v_pli).toBe(d("pliCount", va, vb));
    expect(s.v_freeze_cnt).toBe(d("freezeCount", va, vb));
    // Chrome reports packetsDiscarded for audio only: a missing field is null.
    expect(vb.packetsDiscarded).toBeUndefined();
    expect(s.v_discarded).toBeNull();
    const withDiscarded = new Metrics();
    withDiscarded.next(snap(patchStat(a, va.id, { packetsDiscarded: 4 })), 0);
    expect(withDiscarded.next(snap(patchStat(b, vb.id, { packetsDiscarded: 9 })), 1).v_discarded).toBe(5);
    expect(s.v_freeze_ms).toBeCloseTo(d("totalFreezesDuration", va, vb) * 1000, 6);
  });

  it("QP is qpSum Δ / framesDecoded Δ", () => {
    expect(s.v_qp).toBeCloseTo(d("qpSum", va, vb) / d("framesDecoded", va, vb), 6);
  });

  it("dropped frames come from the element, else from framesDropped", () => {
    expect(s.v_frames_dropped).toBe(3);
    const fallback = new Metrics();
    fallback.next(snap(a, element(null)), 0);
    expect(fallback.next(snap(b, element(null)), 1).v_frames_dropped).toBe(d("framesDropped", va, vb));
  });

  it("jitter buffer and decode time are per-frame averages in ms", () => {
    expect(s.v_jb).toBeCloseTo((d("jitterBufferDelay", va, vb) / d("jitterBufferEmittedCount", va, vb)) * 1000, 6);
    expect(s.v_decode).toBeCloseTo((d("totalDecodeTime", va, vb) / d("framesDecoded", va, vb)) * 1000, 6);
    expect(s.a_jb).toBeCloseTo((d("jitterBufferDelay", aa, ab) / d("jitterBufferEmittedCount", aa, ab)) * 1000, 6);
  });

  it("playout timestamps give the A/V offset", () => {
    expect(s.v_playout_ts).toBe(n(vb, "estimatedPlayoutTimestamp"));
    expect(s.a_playout_ts).toBe(n(ab, "estimatedPlayoutTimestamp"));
    expect(s.av_offset).toBe(n(ab, "estimatedPlayoutTimestamp") - n(vb, "estimatedPlayoutTimestamp"));
  });

  it("codec is stored as an index of the codec name", () => {
    expect(s.v_codec_id).toBe(VIDEO_CODECS.indexOf("VP8"));
  });

  it("audio concealment is concealedSamples Δ / totalSamplesReceived Δ over 5 samples", () => {
    const samples = run(snapshots);
    const last = snapshots.length - 1;
    const first = last - 5;
    const concealed = d("concealedSamples", audioIn(snapshots[first]), audioIn(snapshots[last]));
    const total = d("totalSamplesReceived", audioIn(snapshots[first]), audioIn(snapshots[last]));

    expect(samples[last].a_concealed_pct).toBeCloseTo((concealed / total) * 100, 6);
  });

  it("RTT and channel estimate come from the selected pair", () => {
    expect(s.rtt).toBeCloseTo(n(pairOf(b), "currentRoundTripTime") * 1000, 6);
    expect(s.avail_in).toBeNull();
    const withEstimate = patchStat(b, pairOf(b).id, { availableIncomingBitrate: 2_400_000 });
    expect(new Metrics().next(snap(withEstimate), 0).avail_in).toBe(2400);
  });

  it("path: relay over udp, pair changes from the transport", () => {
    expect(s.pair_type).toBe(CANDIDATE_TYPES.indexOf("relay"));
    expect(s.pair_proto).toBe(PROTOCOLS.indexOf("udp"));
    expect(s.pair_changes).toBe(1);
  });

  it("delay is rtt/2 + jitter buffer + decode (+ render) for video, rtt/2 + jitter buffer for audio", () => {
    expect(s.d_net).toBeCloseTo((s.rtt as number) / 2, 6);
    expect(s.d_jb).toBe(s.v_jb);
    expect(s.d_decode).toBe(s.v_decode);
    expect(s.d_render).toBe(0);
    expect(s.d_video).toBeCloseTo((s.rtt as number) / 2 + (s.v_jb as number) + (s.v_decode as number), 6);
    expect(s.d_audio).toBeCloseTo((s.rtt as number) / 2 + (s.a_jb as number), 6);
  });

  it("frame rate and render delay come from rendered frames", () => {
    const withFrames = new Metrics();
    withFrames.next({ ...snap(a), frames: { fps: 30, latency: 40, freezeMs: 0, sessionMs: 1000, hidden: 0 } }, 0);
    const sample = withFrames.next({ ...snap(b), frames: { fps: 29, latency: 40, freezeMs: 3050, sessionMs: 18000, hidden: 0.25 } }, 1);
    const assembly = (d("totalAssemblyTime", va, vb) / d("framesDecoded", va, vb)) * 1000;

    expect(sample.v_fps_r).toBe(29);
    // Freezes & Stalls: Σ rVFC freezes / session duration × 100.
    expect(sample.v_freeze_pct).toBeCloseTo((3050 / 18000) * 100, 6);
    expect(sample.v_render).toBeCloseTo(
      Math.max(0, 40 - ((sample.v_jb as number) - assembly) - (sample.v_decode as number)),
      6
    );
    expect(sample.d_render).toBe(sample.v_render);
    // A quarter of the second the tab was hidden or the video paused.
    expect(sample.hidden).toBe(0.25);
    expect(s.v_fps_r).toBeNull();
    expect(s.v_render).toBeNull();
    expect(s.v_freeze_pct).toBeNull();
    expect(s.hidden).toBeNull();
  });

  it("delay has no value without jitter buffer data", () => {
    const first = new Metrics().next(snap(b), 0);
    expect(first.d_video).toBeNull();
    expect(first.d_audio).toBeNull();
    expect(first.d_net).not.toBeNull();
  });
});

describe("renderDelay", () => {
  const frames = (latency: number | null) => ({
    fps: 30, latency, freezeMs: 0, sessionMs: 1000, hidden: 0,
  });

  it("subtracts the jitter buffer after the last packet and the decode time", () => {
    // presentation − receive 19 ms = (jb 9 − assembly 0.5) + decode 1 + render 9.5
    expect(renderDelay(frames(19), 9, 0.5, 1)).toBeCloseTo(9.5, 6);
    // Jitter: the frame is assembled for 9 ms of its 111 ms in the buffer.
    expect(renderDelay(frames(110.9), 110.8, 9, 0.5)).toBeCloseTo(8.6, 6);
  });

  it("is 0 without receiveTime, null without frames or without jitter buffer data", () => {
    expect(renderDelay(frames(null), 9, 0, 1)).toBe(0);
    expect(renderDelay({ ...frames(null), fps: 0 }, 9, 0, 1)).toBeNull();
    expect(renderDelay(undefined, 9, 0, 1)).toBeNull();
    expect(renderDelay(frames(19), null, 0, 1)).toBeNull();
  });

  it("is never negative", () => {
    expect(renderDelay(frames(5), 30, 0, 1)).toBe(0);
  });
});

describe("path", () => {
  const cand = (candidateType: string, protocol = "udp", relayProtocol?: string): RtpStats =>
    ({ id: candidateType, type: "local-candidate", timestamp: 0, candidateType, protocol, relayProtocol });

  it("shows the remote type when it is relay, else the local type", () => {
    expect(pathType(cand("host"), cand("host"))).toBe("host");
    expect(pathType(cand("srflx"), cand("relay"))).toBe("relay");
    expect(pathType(cand("relay"), cand("srflx"))).toBe("relay");
    expect(pathType(cand("prflx"), cand("srflx"))).toBe("prflx");
  });

  it("uses the relay protocol of a relay candidate", () => {
    expect(pathProtocol(cand("relay", "udp", "tcp"))).toBe("tcp");
    expect(pathProtocol(cand("host", "udp"))).toBe("udp");
  });

  it("counts changes of the selected pair when the transport does not", () => {
    const [a, b] = snapshots;
    const transport = findStat(a, "transport");
    const strip = (stats: StatsList) => patchStat(stats, transport.id, { selectedCandidatePairChanges: undefined });
    const other = patchStat(strip(b), transport.id, { selectedCandidatePairId: "other-pair" });
    const moved = [...other, { ...pairOf(b), id: "other-pair" }];
    const metrics = new Metrics();

    expect(metrics.next(snap(strip(a)), 0).pair_changes).toBe(0);
    expect(metrics.next(snap(moved), 1).pair_changes).toBe(1);
  });
});

describe("outgoing video (PRD §6.3)", () => {
  // The receiver of a two-way call; its outgoing video turns cpu-limited from the 4th report.
  const twoWay = loadSnapshots("two-way-cpu.json");
  const outOf = (stats: StatsList) => findStat(stats, "outbound-rtp", "video");
  const twoWaySelector = { videoTrackId: videoIn(twoWay[0]).trackIdentifier, audioTrackId: audioIn(twoWay[0]).trackIdentifier };
  const runTwoWay = (reports: StatsList[]) => {
    const metrics = new Metrics();
    return reports.map((stats, i) => metrics.next(extract(toReport(stats), twoWaySelector), i));
  };
  const layer = (id: string, patch: Record<string, unknown>): RtpStats => ({
    id, type: "outbound-rtp", kind: "video", timestamp: 0, ssrc: id.length, ...patch,
  });

  it("bitrate is bytesSent Δ × 8 / Δt, target and size are the encoder's, the limitation is its reason", () => {
    const samples = runTwoWay(twoWay);
    const [a, b] = [outOf(twoWay[4]), outOf(twoWay[5])];

    expect(samples[0].out_bitrate).toBeNull();
    expect(samples[5].out_bitrate).toBeCloseTo((d("bytesSent", a, b) * 8) / (b.timestamp - a.timestamp), 6);
    expect(samples[5].out_target).toBeCloseTo(n(b, "targetBitrate") / 1000, 6);
    expect([samples[0].out_w, samples[0].out_h]).toEqual([640, 360]);
    expect([samples[5].out_w, samples[5].out_h, samples[5].out_fps]).toEqual([480, 270, n(b, "framesPerSecond")]);
    expect(samples.map((s) => s.out_limit)).toEqual([0, 0, 0, 1, 1, 1, 1].map((i) => QUALITY_LIMITS.indexOf(i ? "cpu" : "none")));
    // Chrome hides the encoder without a camera or microphone permission.
    expect(b.powerEfficientEncoder).toBeUndefined();
    expect(samples[5].out_encoder).toBeNull();
  });

  it("tells a hardware encoder by powerEfficientEncoder", () => {
    const hardware = patchStat(twoWay[0], outOf(twoWay[0]).id, { powerEfficientEncoder: true, encoderImplementation: "VideoToolbox" });
    const software = patchStat(twoWay[0], outOf(twoWay[0]).id, { powerEfficientEncoder: false });

    expect(runTwoWay([hardware])[0].out_encoder).toBe(ENCODER_KINDS.indexOf("hardware"));
    expect(runTwoWay([software])[0].out_encoder).toBe(ENCODER_KINDS.indexOf("software"));
  });

  it("sums the bitrate and target of simulcast layers; size and limitation are the top active layer's", () => {
    const prev = [layer("q", { bytesSent: 0, timestamp: 0 }), layer("hh", { bytesSent: 0, timestamp: 0 }), layer("fff", { bytesSent: 0, timestamp: 0 })];
    const cur = [
      layer("q", { bytesSent: 12_500, timestamp: 1000, targetBitrate: 100_000, frameWidth: 320, frameHeight: 180, framesPerSecond: 30, qualityLimitationReason: "bandwidth" }),
      layer("hh", { bytesSent: 50_000, timestamp: 1000, targetBitrate: 400_000, frameWidth: 640, frameHeight: 360, framesPerSecond: 30, qualityLimitationReason: "bandwidth" }),
      // The full layer is switched off.
      layer("fff", { bytesSent: 0, timestamp: 1000, targetBitrate: 0, frameWidth: 1280, frameHeight: 720, active: false }),
    ];

    expect(outgoing(cur, prev)).toEqual({
      out_bitrate: 500,
      out_target: 500,
      out_w: 640,
      out_h: 360,
      out_fps: 30,
      out_limit: QUALITY_LIMITS.indexOf("bandwidth"),
      out_encoder: null,
    });
  });

  it("has no values without outgoing video", () => {
    const s = run(snapshots.slice(0, 2))[1];
    expect([s.out_bitrate, s.out_target, s.out_w, s.out_h, s.out_fps, s.out_limit, s.out_encoder]).toEqual([null, null, null, null, null, null, null]);
    // Sending has not started: no size yet, but the reason is known.
    expect(outgoing([layer("a", { qualityLimitationReason: "none" })], [])).toMatchObject({ out_w: null, out_limit: 0, out_bitrate: null });
  });
});
