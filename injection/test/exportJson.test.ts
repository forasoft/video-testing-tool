import { describe, expect, it } from "vitest";
import { SAMPLE_FIELDS } from "shared/constants/sampleFields";
import { ProblemMessage } from "shared/protocol";
import { SampleBuffer } from "src/session/buffer";
import {
  exportCandidate, exportFilename, exportMedia, ExportSource, exportTrack, jsonText, roundValue, SCHEMA, sessionJson,
} from "src/session/export/json";
import { createSelector, extract } from "src/session/extract";
import { emptySample } from "src/session/metrics";
import { reportStats } from "src/session/report";
import { findStat, loadSnapshots, toReport } from "./fixtures";

const [stats] = loadSnapshots("receive-only-loss5.json");

const problem: ProblemMessage = {
  id: 1,
  type: "bandwidth_drop",
  title: "Bandwidth drop",
  category: "Network",
  severity: "severe",
  tStart: 38.5,
  tEnd: 48.2,
  open: false,
  oneLine: "bitrate 1 800 → 210 kbps, 1 freeze",
  card: {
    series: { name: "v_bitrate", points: [[37, 1800], [38, 1790]] },
    rows: [["Bitrate", "1 800 → 210 kbps"], ["Packet loss", "max 6.2 %"]],
    likelyCause: "Network between you and the sender: packet loss spiked to 6.2 %.",
    check: "Wi-Fi/VPN on this machine. If it happens to everyone at once — SFU or the sender's uplink.",
  },
};

const bufferOf = (count: number, capacity = 3600) => {
  const buffer = new SampleBuffer(capacity);
  for (let t = 0; t < count; t++) {
    const s = emptySample();
    s.t = t;
    s.v_bitrate = t === 0 ? null : 1546.23456 + t;
    s.v_loss = 0.123456;
    buffer.push(s);
  }
  return buffer;
};

const source = (buffer = bufferOf(3)): ExportSource => ({
  extensionVersion: "1.0.0",
  startedAt: Date.UTC(2026, 8, 24, 10, 0, 0),
  endedAt: Date.UTC(2026, 8, 24, 10, 0, 2, 500),
  durationS: 2.5,
  state: "stopped",
  origin: "http://localhost:8080",
  url: "http://localhost:8080/",
  hostname: "localhost",
  userAgent: "Chrome",
  buffer,
  events: [{
    n: 1, t: 0.05, kind: "first_frame", label: "First frame 0.05 s", tone: "green",
  }],
  problems: [problem],
  verdict: {
    level: "Severe", degradedS: 9.7, worst: 1, text: "Worst: Bandwidth drop at 0:38 — bitrate 1 800 → 210 kbps, 1 freeze",
  },
  report: reportStats({
    buffer, t: 2.5, freezes: [{ start: 0.5, end: 1.7 }], suspended: [], firstFrameS: 0.0512,
  }),
  previousRun: {
    startedAt: "2026-09-24T09:00:00.000Z", durationS: 64.3, verdict: "Degraded", degradedS: 14.2, freezes: 3, p95DelayMs: 610, p95LossPct: 5.1, p50BitrateKbps: 1290,
  },
  streams: [
    {
      id: "v1", name: "Stream 1", selected: true, w: 1280, h: 720, bitrate: 1546.2345, loss: 0.21, freezes: 2.1, goodness: "good", tooltip: "track v1 · mid 0",
    },
    {
      id: "v2", name: "Stream 2", selected: false, w: 640, h: 360, bitrate: 612.34567, loss: 1.40049, freezes: 0, goodness: "moderate", tooltip: "track v2 · mid 2",
    },
  ],
  ...exportMedia(extract(toReport(stats), createSelector({ getTransceivers: (): RTCRtpTransceiver[] => [] } as unknown as RTCPeerConnection, [
    { kind: "video", id: findStat(stats, "inbound-rtp", "video").trackIdentifier },
    { kind: "audio", id: findStat(stats, "inbound-rtp", "audio").trackIdentifier },
  ] as unknown as MediaStreamTrack[])), 2),
  sdp: { local: "v=0\r\no=- 1 2 IN IP4 127.0.0.1\r\n", remote: null },
});

// JSON export, PRD §15.1, schema §22.
describe("JSON export", () => {
  it("follows the schema of §22", () => {
    const data = sessionJson(source());

    expect(Object.keys(data)).toEqual([
      "schema", "extensionVersion", "session", "stream", "connection", "sdp", "samples", "events", "problems", "verdict",
      "distribution", "freezes", "firstFrameS", "otherStreams", "previousRun",
    ]);
    expect(data.schema).toBe(SCHEMA);
    expect(data.session).toEqual({
      startedAt: "2026-09-24T10:00:00.000Z",
      endedAt: "2026-09-24T10:00:02.500Z",
      durationS: 2.5,
      state: "stopped",
      origin: "http://localhost:8080",
      url: "http://localhost:8080/",
      userAgent: "Chrome",
      truncated: false,
    });
    expect(data.verdict).toEqual({
      level: "Severe", degradedS: 9.7, worstProblemId: 1, text: "Worst: Bandwidth drop at 0:38 — bitrate 1 800 → 210 kbps, 1 freeze",
    });
    // The other streams of the table (§13.4) without the selected one: its data is the rest of the file.
    expect(data.otherStreams).toEqual([{
      id: "v2", name: "Stream 2", w: 640, h: 360, bitrate: 612.346, loss: 1.4, freezes: 0,
    }]);
    // The run this session is compared with (§13.1), as stored.
    expect(data.previousRun).toEqual({
      startedAt: "2026-09-24T09:00:00.000Z", durationS: 64.3, verdict: "Degraded", degradedS: 14.2, freezes: 3, p95DelayMs: 610, p95LossPct: 5.1, p50BitrateKbps: 1290,
    });
    // The Distribution of the Report (§13.3) with the samples' three decimals.
    expect(data.distribution.v_bitrate).toEqual({ p50: 1547.735, p5: 1547.285, min: 1547.235 });
    expect(data.distribution.v_loss).toEqual({ p50: 0.123, p95: 0.123, max: 0.123 });
    expect(data.distribution.rtt).toEqual({ p50: null, p95: null, max: null });
    expect(data.freezes).toEqual({
      count: 1, totalS: 1.2, longestS: 1.2, pct: 48,
    });
    expect(data.firstFrameS).toBe(0.051);
    expect(data.sdp.local).toContain("v=0");
  });

  it("holds every sample column-wise in the order of §6.3, null for no data, three decimals", () => {
    const { samples } = sessionJson(source());

    expect(Object.keys(samples)).toEqual([...SAMPLE_FIELDS]);
    expect(Object.values(samples).every((column) => column.length === 3)).toBe(true);
    expect(samples.t).toEqual([0, 1, 2]);
    expect(samples.v_bitrate).toEqual([null, 1547.235, 1548.235]);
    expect(samples.v_loss).toEqual([0.123, 0.123, 0.123]);
    expect(samples.d_video).toEqual([null, null, null]);
    expect(roundValue(null)).toBeNull();
  });

  it("marks a session longer than the buffer as truncated", () => {
    const data = sessionJson(source(bufferOf(5, 4)));

    expect(data.session.truncated).toBe(true);
    expect(data.samples.t).toEqual([1, 2, 3, 4]);
  });

  it("lists events without their color and problems with the texts of their cards", () => {
    const data = sessionJson(source());

    expect(data.events).toEqual([{
      n: 1, t: 0.05, kind: "first_frame", label: "First frame 0.05 s",
    }]);
    expect(data.problems).toEqual([{
      id: 1,
      type: "bandwidth_drop",
      title: "Bandwidth drop",
      category: "Network",
      severity: "severe",
      tStart: 38.5,
      tEnd: 48.2,
      oneLine: "bitrate 1 800 → 210 kbps, 1 freeze",
      rows: [["Bitrate", "1 800 → 210 kbps"], ["Packet loss", "max 6.2 %"]],
      likelyCause: "Network between you and the sender: packet loss spiked to 6.2 %.",
      check: "Wi-Fi/VPN on this machine. If it happens to everyone at once — SFU or the sender's uplink.",
    }]);
  });

  it("takes the stream and the connection from getStats of the stand", () => {
    const { stream, connection } = sessionJson(source());

    expect(stream.video).toEqual({
      trackId: findStat(stats, "inbound-rtp", "video").trackIdentifier, mid: "0", ssrc: 1585666210, codec: "VP8", fmtp: null,
    });
    expect(stream.audio).toMatchObject({ mid: "1", codec: "opus", fmtp: "minptime=10;useinbandfec=1" });
    expect(stream.element).toBeNull();
    expect(connection).toEqual({
      local: {
        candidateType: "relay", address: "172.28.0.2", port: 49184, protocol: "udp", relayProtocol: "udp", url: "turn:127.0.0.1:3479?transport=udp", networkType: "unknown",
      },
      remote: {
        candidateType: "relay", address: "172.28.0.2", port: 49194, protocol: "udp",
      },
      turnUrl: "turn:127.0.0.1:3479?transport=udp",
      decoder: null,
      encoder: null,
    });
  });

  it("fills the element, decoder and encoder when the browser reports them", () => {
    const media = exportMedia({
      element: {
        videoWidth: 1280, videoHeight: 720, clientWidth: 640, clientHeight: 360, droppedFrames: 0, readyState: 4,
      },
      video: {
        id: "v", timestamp: 0, type: "inbound-rtp", decoderImplementation: "libvpx",
      },
      outbound: [{
        id: "o1", timestamp: 0, type: "outbound-rtp", encoderImplementation: "",
      }, {
        id: "o2", timestamp: 0, type: "outbound-rtp", encoderImplementation: "libvpx",
      }],
      local: {
        id: "l", timestamp: 0, type: "local-candidate", candidateType: "host", url: "turn:ignored",
      },
    }, 2);

    expect(media.stream.element).toEqual({ clientWidth: 640, clientHeight: 360, dpr: 2 });
    expect(media.connection).toMatchObject({ decoder: "libvpx", encoder: "libvpx", turnUrl: null });
    expect(exportTrack(undefined)).toBeNull();
    expect(exportCandidate(undefined)).toBeNull();
    expect(exportMedia(null, null).stream).toEqual({ video: null, audio: null, element: null });
  });

  it("keeps arrays of values on one line and stays valid JSON", () => {
    const data = sessionJson(source());
    const text = jsonText(data);

    expect(JSON.parse(text)).toEqual(data);
    expect(text).toContain("\"t\": [0, 1, 2]");
    expect(text).toContain("\"v_bitrate\": [null, 1547.235, 1548.235]");
    expect(text).toContain("[\"Bitrate\", \"1 800 → 210 kbps\"]");
    // Objects stay indented.
    expect(text).toContain("\n  \"session\": {\n    \"startedAt\"");
  });

  it("names the file after the host and the session's start in local time", () => {
    const start = new Date(2026, 8, 4, 9, 5, 7).getTime();

    expect(exportFilename("meet.example.com", start, "json")).toBe("streamtest_meet.example.com_20260904-090507.json");
    expect(exportFilename("localhost", start, "csv")).toBe("streamtest_localhost_20260904-090507.csv");
    expect(exportFilename("", start, "json")).toBe("streamtest_page_20260904-090507.json");
    expect(exportFilename("[::1]", start, "json")).toBe("streamtest__1__20260904-090507.json");
  });
});
