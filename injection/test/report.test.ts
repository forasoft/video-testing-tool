import { describe, expect, it } from "vitest";
import { SampleValues } from "shared/constants/sampleFields";
import {
  ConnectionInfo, ProblemCategory, ProblemMessage, Severity,
} from "shared/protocol";
import { SampleBuffer } from "src/session/buffer";
import { emptySample } from "src/session/metrics";
import {
  attribution, degradedLabel, distributionRows, localMinute, problemInterval, reportMessage, reportStats, reportText, sessionVerdict, summaryText,
} from "src/session/report";

let nextId = 1;
const problem = (
  title: string, category: ProblemCategory, severity: Severity, tStart: number, tEnd: number | null
): ProblemMessage => ({
  id: nextId++,
  type: "test",
  title,
  category,
  severity,
  tStart,
  tEnd,
  open: tEnd === null,
  oneLine: "…",
  card: { series: { name: "v_bitrate", points: [] }, rows: [], likelyCause: "", check: "" },
});

describe("attribution (PRD §12.5)", () => {
  it("names the side the problems came from", () => {
    expect(attribution([])).toBe("");
    expect(attribution([problem("Bandwidth drop", "Network", "warn", 1, 5), problem("Blurry picture", "Sender", "warn", 9, 20)]))
      .toBe("Network, not the page.");
    expect(attribution([problem("Page jank", "Page", "warn", 1, 2), problem("Video freeze", "Device", "warn", 5, 7)]))
      .toBe("The page or this device, not the network.");
    expect(attribution([problem("Video freeze", "Device", "severe", 1, 5), problem("Your upload limited by CPU", "Sender", "warn", 9, 30)]))
      .toBe("Both network and this device.");
  });
});

describe("reportText (PRD §12.5)", () => {
  it("gives Σ of the session, the worst problem with its duration and the attribution", () => {
    const drop = problem("Bandwidth drop", "Network", "warn", 38.5, 48.2);
    const jank = problem("Page jank", "Page", "warn", 62, 62.5);

    expect(reportText([drop, jank], 120)).toBe("Degraded 10.2 s of 2:00. Worst: Bandwidth drop at 0:38 (9.7 s). Both network and this device.");
  });

  it("says so without problems", () => {
    expect(reportText([], 72.4)).toBe("No problems in 1:12.");
  });

  it("puts a severe problem first and counts an open one up to now", () => {
    const long = problem("Bandwidth drop", "Network", "warn", 10, 40);
    const open = problem("Reconnection", "Network", "severe", 50, null);

    expect(reportText([long, open], 57.25)).toBe("Severe 37.3 s of 0:57. Worst: Reconnection at 0:50 (7.3 s). Network, not the page.");
  });
});

describe("sessionVerdict", () => {
  it("is the verdict of the Timeline with the Report's text", () => {
    const freeze = problem("Video freeze", "Device", "warn", 20, 22.4);

    expect(sessionVerdict([freeze], 30)).toEqual({
      level: "Degraded",
      degradedS: 2.4,
      worst: freeze.id,
      text: "Worst: Video freeze at 0:20 — …",
      report: "Degraded 2.4 s of 0:30. Worst: Video freeze at 0:20 (2.4 s). The page or this device, not the network.",
    });
    expect(sessionVerdict([], 5).report).toBe("No problems in 0:05.");
  });
});

// A buffer of samples t = 0…n−1; `at(t)` sets the fields of a second.
const bufferOf = (n: number, at: (t: number) => Partial<SampleValues>, capacity = 3600): SampleBuffer => {
  const buffer = new SampleBuffer(capacity);
  for (let t = 0; t < n; t++) {
    buffer.push({ ...emptySample(), t, hidden: 0, ...at(t) });
  }
  return buffer;
};

describe("reportStats (PRD §13.3)", () => {
  it("takes p5 and the minimum where low is bad, p95 and the maximum where high is bad, without nulls", () => {
    // Bitrate 100, 200, … 2 000 kbps; loss 0 … 1.9 %; delay and RTT unknown in the first second.
    const buffer = bufferOf(20, (t) => ({
      v_bitrate: (t + 1) * 100, v_loss: t / 10, d_video: t === 0 ? null : 100 + t, rtt: t === 0 ? null : 40 + t, v_h: 720,
    }));
    const { distribution: d, heightP50 } = reportStats({
      buffer, t: 19, freezes: [], suspended: [], firstFrameS: null,
    });

    expect(d.v_bitrate).toEqual({ p50: 1050, p5: 195, min: 100 });
    expect(d.v_loss.p50).toBeCloseTo(0.95);
    expect(d.v_loss.p95).toBeCloseTo(1.805);
    expect(d.v_loss.max).toBeCloseTo(1.9);
    // 19 values 101…119: the null of the first second is left out.
    expect(d.d_video).toMatchObject({ p50: 110, max: 119 });
    expect(d.d_video.p95).toBeCloseTo(118.1);
    expect(d.rtt).toMatchObject({ p50: 50, max: 59 });
    expect(d.rtt.p95).toBeCloseTo(58.1);
    expect(heightP50).toBe(720);
  });

  it("leaves the seconds with a hidden tab or a paused video out of Frame rate only", () => {
    // 30 fps, but 0 fps in the three seconds the video was paused (in part in the first and the last).
    const hidden = [0, 0, 0, 0, 0, 0.4, 1, 1, 0.6, 0, 0, 0];
    const buffer = bufferOf(12, (t) => ({
      v_fps_r: hidden[t] > 0 ? 0 : 30, v_bitrate: hidden[t] > 0 ? 0 : 1000, hidden: hidden[t],
    }));
    const { distribution: d } = reportStats({
      buffer, t: 11, freezes: [], suspended: [{ start: 4.6, end: 7.6 }], firstFrameS: null,
    });

    expect(d.v_fps_r).toEqual({ p50: 30, p5: 30, min: 30 });
    // Bitrate keeps them: the stream did stop arriving.
    expect(d.v_bitrate.min).toBe(0);
  });

  it("counts the freezes and their share of the time frames were counted", () => {
    const buffer = bufferOf(61, () => ({ v_fps_r: 30 }));
    const stats = reportStats({
      buffer,
      t: 60,
      freezes: [{ start: 10, end: 12.4 }, { start: 30, end: 30.2 }, { start: 50, end: 51 }],
      // 10 s hidden: the share is of 50 s.
      suspended: [{ start: 20, end: 30 }],
      firstFrameS: 1.8423,
    });

    expect(stats.freezes.count).toBe(3);
    expect(stats.freezes.totalS).toBeCloseTo(3.6);
    expect(stats.freezes.longestS).toBeCloseTo(2.4);
    expect(stats.freezes.pct).toBeCloseTo(7.2);
    expect(stats.firstFrameS).toBe(1.8423);
    expect(stats.truncatedFrom).toBeNull();
  });

  it("keeps to the samples of the buffer once older ones were dropped (PRD §16 F14)", () => {
    // A 10 s buffer of a 20 s session: samples 10…19, the freezes of 9…19.
    const buffer = bufferOf(20, (t) => ({ v_bitrate: t < 10 ? 0 : 1000 }), 10);
    const stats = reportStats({
      buffer, t: 19, freezes: [{ start: 2, end: 4 }, { start: 8.5, end: 10 }], suspended: [], firstFrameS: 0.5,
    });

    expect(stats.truncatedFrom).toBe(10);
    expect(stats.distribution.v_bitrate.min).toBe(1000);
    expect(stats.freezes).toMatchObject({ count: 1, totalS: 1, longestS: 1 });
    expect(stats.freezes.pct).toBeCloseTo(10);
  });
});

describe("distributionRows (PRD §13.3)", () => {
  const stats = reportStats({
    buffer: bufferOf(21, (t) => ({
      v_bitrate: t === 3 ? 30 : 1520, v_fps_r: t === 3 ? 0 : 29.8, v_loss: t === 3 ? 6.2 : 0.24, d_video: t === 3 ? 674 : 142,
      rtt: t === 3 ? 116 : 46, v_h: t < 5 ? 360 : 540,
    })),
    t: 20,
    freezes: [{ start: 2.2, end: 4.6 }, { start: 15, end: 15.2 }],
    suspended: [],
    firstFrameS: 1.8412,
  });

  it("formats the numbers as the tiles do, with the good threshold of §7 as the target", () => {
    const rows = distributionRows(stats);

    expect(rows.map((r) => r.metric)).toEqual([
      "Bitrate, kbps", "Frame rate, fps", "Packet loss, %", "Video delay, ms", "RTT, ms", "Freezes", "First frame",
    ]);
    expect(rows[0]).toEqual({
      metric: "Bitrate, kbps", typical: "1\u202F520", bad: "1\u202F520 (p5)", worst: "30", goodness: "bad", target: "≥ 1\u202F200",
    });
    expect(rows[1]).toEqual({
      metric: "Frame rate, fps", typical: "29.8", bad: "29.8 (p5)", worst: "0.0", goodness: "bad", target: "≥ 24",
    });
    expect(rows[2]).toEqual({
      metric: "Packet loss, %", typical: "0.24", bad: "0.24", worst: "6.20", goodness: "bad", target: "< 1",
    });
    expect(rows[3]).toMatchObject({ worst: "674", goodness: "moderate", target: "< 300" });
    expect(rows[4]).toMatchObject({ typical: "46", worst: "116", goodness: "good", target: "< 150" });
    expect(rows[5]).toEqual({
      metric: "Freezes", typical: "2 · 2.6 s total · longest 2.4 s · 13.00 %", goodness: "bad", target: "< 1 %",
    });
    expect(rows[6]).toEqual({
      metric: "First frame", typical: "1.84 s", goodness: "good", target: "< 4 s",
    });
  });

  it("takes the bitrate target by the p50 frame height", () => {
    const at = (h: number, kbps: number) => distributionRows(reportStats({
      buffer: bufferOf(5, () => ({ v_bitrate: kbps, v_h: h })), t: 4, freezes: [], suspended: [], firstFrameS: null,
    }))[0];

    expect(at(360, 1000)).toMatchObject({ target: "≥ 700", goodness: "good" });
    expect(at(540, 1000)).toMatchObject({ target: "≥ 1\u202F200", goodness: "moderate" });
    expect(at(720, 1000)).toMatchObject({ target: "≥ 2\u202F000", goodness: "moderate" });
    expect(at(1080, 900)).toMatchObject({ target: "≥ 2\u202F000", goodness: "bad" });
  });

  it("shows `—` without data and colors nothing", () => {
    const rows = distributionRows(reportStats({
      buffer: new SampleBuffer(), t: 0, freezes: [], suspended: [], firstFrameS: null,
    }));

    expect(rows.map((r) => [r.typical, r.bad, r.worst])).toEqual([
      ["—", "—", "—"], ["—", "—", "—"], ["—", "—", "—"], ["—", "—", "—"], ["—", "—", "—"], ["—", undefined, undefined], ["—", undefined, undefined],
    ]);
    expect(rows.every((r) => r.goodness === undefined)).toBe(true);
    expect(rows[6].target).toBe("< 4 s");
    // First frame 4–8 s is yellow, later red (Slow start).
    const late = (s: number) => distributionRows(reportStats({
      buffer: new SampleBuffer(), t: 0, freezes: [], suspended: [], firstFrameS: s,
    }))[6].goodness;
    expect([late(3.9), late(6.3), late(10.3)]).toEqual(["good", "moderate", "bad"]);
  });

  it("makes VTT_REPORT of the rows", () => {
    const stats = reportStats({
      buffer: bufferOf(3, () => ({ v_bitrate: 800 })), t: 2, freezes: [], suspended: [], firstFrameS: 0.05,
    });

    const message = reportMessage(stats);
    expect(message).toMatchObject({ previousRun: null, truncatedFrom: null });
    expect(message.distribution.find(({ metric }) => metric === "First frame")?.typical).toBe("0.05 s");
    expect(reportMessage(stats, [{ text: "Previous run on this site: " }]).previousRun).toEqual([{ text: "Previous run on this site: " }]);
  });
});

describe("summaryText (PRD §15.3)", () => {
  const startedAt = new Date(2026, 8, 25, 14, 7, 31).getTime();
  const stats = reportStats({
    buffer: bufferOf(121, (t) => ({
      v_bitrate: t >= 38 && t < 48 ? 210 : 1520, v_fps_r: t >= 38 && t < 48 ? 9.4 : 29.8, v_loss: t >= 38 && t < 48 ? 3.9 : 0.24,
      d_video: t >= 38 && t < 48 ? 512 : 142, rtt: t >= 38 && t < 48 ? 104 : 46, v_h: 720,
    })),
    t: 120,
    freezes: [{ start: 45.8, end: 48.2 }, { start: 90, end: 90.2 }],
    suspended: [],
    firstFrameS: 1.8412,
  });
  const connection: ConnectionInfo = {
    videoCodec: "H264", audioCodec: "opus", localType: "srflx", remoteType: "relay", type: "relay", proto: "udp", relayProtocol: null, rttMs: 46, tooltip: [],
  };

  it("follows the template: session, verdict, problems, distribution, codecs and path", () => {
    const drop = { ...problem("Bandwidth drop", "Network", "severe", 38.5, 48.2), oneLine: "bitrate 1 800 → 210 kbps, 1 freeze" };
    const jank = { ...problem("Page jank", "Page", "warn", 62, 62.5), oneLine: "main thread blocked 480 ms" };
    const path = { ...problem("Connection path changed", "Network", "warn", 76.5, null), oneLine: "→ relay · udp, RTT 46 → 92 ms" };

    expect(summaryText({
      hostname: "meet.example.com", startedAt, t: 120, problems: [path, drop, jank], stats, connection,
    })).toBe([
      "StreamTest — meet.example.com — 2026-09-25 14:07 — 2:00",
      "Severe 53.7 s. Both network and this device.",
      "Problems (3):",
      "  0:38–0:48  Bandwidth drop (9.7 s) — bitrate 1 800 → 210 kbps, 1 freeze",
      "  1:02  Page jank (0.5 s) — main thread blocked 480 ms",
      "  1:16–now  Connection path changed (43.5 s) — → relay · udp, RTT 46 → 92 ms",
      "Bitrate p50 1\u202F520 kbps (p5 210) · Frame rate p50 29.8 (p5 9.4) · Loss p95 3.90 % · Delay p95 512 ms · RTT p95 104 ms · Freezes 2 / 2.6 s / 2.17 %",
      "Codecs H264 / opus · Path srflx→relay · udp · First frame 1.84 s",
    ].join("\n"));
  });

  it("says OK 0 s without problems and `—` for what is unknown", () => {
    const empty = reportStats({
      buffer: new SampleBuffer(), t: 3, freezes: [], suspended: [], firstFrameS: null,
    });

    expect(summaryText({
      hostname: "localhost", startedAt, t: 3.4, problems: [], stats: empty, connection: null,
    }).split("\n")).toEqual([
      "StreamTest — localhost — 2026-09-25 14:07 — 0:03",
      "OK 0 s.",
      "Problems (0):",
      "Bitrate p50 — kbps (p5 —) · Frame rate p50 — (p5 —) · Loss p95 — % · Delay p95 — ms · RTT p95 — ms · Freezes 0 / 0.0 s / 0.00 %",
      "Codecs — / — · Path — · First frame —",
    ]);
  });

  it("writes the minute in local time, the Σ of the verdict and the intervals of the list", () => {
    expect(localMinute(new Date(2026, 0, 5, 9, 3, 59).getTime())).toBe("2026-01-05 09:03");
    expect([degradedLabel("OK", 0), degradedLabel("Degraded", 9.66), degradedLabel("Severe", 33)]).toEqual(["0 s", "9.7 s", "33.0 s"]);
    expect([
      problemInterval(problem("A", "Network", "warn", 38.5, 48.2)),
      problemInterval(problem("B", "Page", "warn", 62, 62.9)),
      problemInterval(problem("C", "Network", "warn", 76.5, null)),
    ]).toEqual(["0:38–0:48", "1:02", "1:16–now"]);
  });
});
