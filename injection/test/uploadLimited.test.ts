import { describe, expect, it } from "vitest";
import { QUALITY_LIMITS } from "shared/constants/sampleFields";
import { SenderInfo, senderInfo, UploadLimited } from "src/session/problems/uploadLimited";
import { extract } from "src/session/extract";
import { findStat, loadSnapshots, patchStat, toReport } from "./fixtures";
import { makeSamples, runDetectors, Segment, STEADY, Values } from "./makeSamples";

const NS = " ";
const NONE = QUALITY_LIMITS.indexOf("none");
const CPU = QUALITY_LIMITS.indexOf("cpu");
const BANDWIDTH = QUALITY_LIMITS.indexOf("bandwidth");
const OTHER = QUALITY_LIMITS.indexOf("other");

// The receiver's own 640×360 video of a two-way call, as on the stand.
const SENDING: Values = {
  out_bitrate: 900, out_target: 1700, out_w: 640, out_h: 360, out_fps: 30, out_limit: NONE,
};
const LIBVPX: SenderInfo = { encoder: "libvpx", width: 640, height: 360 };

const run = (segments: Segment[], { duration = 80, sender = LIBVPX, base = {} as Values } = {}) =>
  runDetectors([new UploadLimited(() => sender)], makeSamples({ duration, base: { ...STEADY, ...SENDING, ...base }, segments }));

// PRD §12.3, problem 6.
describe("Your upload limited by CPU / bandwidth", () => {
  it("opens after 3 cpu-limited samples, ends at the first of 3 free ones", () => {
    const { problems, sent } = run([{
      from: 30, to: 50, values: { out_limit: CPU, out_w: 480, out_h: 270, out_bitrate: 600 },
    }]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      type: "upload_limited",
      title: "Your upload limited by CPU",
      category: "Sender",
      severity: "warn",
      tStart: 30,
      tEnd: 50,
      open: false,
      oneLine: `cpu, 20 s, 600 of 1${NS}700 kbps`,
    });
    expect(problems[0].card.rows).toEqual([
      ["Reason", "cpu"],
      ["Sent / requested", `600 / 1${NS}700 kbps`],
      ["Sent resolution", "480×270 @ 30 fps"],
      ["Encoder", "libvpx"],
    ]);
    expect(problems[0].card.likelyCause).toBe("This machine cannot encode 640×360 in real time (libvpx).");
    expect(problems[0].card.check).toBe("Close other apps; lower the capture resolution; check that hardware encoding is used.");
    expect(problems[0].card.series.name).toBe("out_bitrate");
    expect(problems[0].card.dashed?.name).toBe("out_target");
    // Shown once it is known: at the third limited sample.
    expect(sent[0]).toMatchObject({ tStart: 30, open: true, oneLine: `cpu, 2 s, 600 of 1${NS}700 kbps` });
  });

  it("names the bandwidth and the target it had before the start", () => {
    const { problems } = run([{
      from: 30, to: 55, values: { out_limit: BANDWIDTH, out_target: 200, out_bitrate: 180, out_w: 320, out_h: 180 },
    }]);

    expect(problems[0]).toMatchObject({
      title: "Your upload limited by bandwidth", tStart: 30, tEnd: 55, oneLine: `bandwidth, 25 s, 180 of 1${NS}700 kbps`,
    });
    expect(problems[0].card.rows[1]).toEqual(["Sent / requested", `180 / 1${NS}700 kbps`]);
    expect(problems[0].card.likelyCause).toBe(`Your uplink cannot carry 1${NS}700 kbps.`);
    expect(problems[0].card.check).toBe("Uplink speed on this machine; other uploads running?");
  });

  it("needs 3 limited samples in a row and 3 free ones to end", () => {
    const blips = run([
      { from: 20, to: 22, values: { out_limit: CPU } },
      { from: 23, to: 25, values: { out_limit: BANDWIDTH } },
    ]);
    expect(blips.problems).toEqual([]);

    const { problems } = run([
      { from: 30, to: 45, values: { out_limit: CPU } },
      { from: 47, to: 48, values: { out_limit: CPU } },
    ]);
    expect(problems).toEqual([expect.objectContaining({ tStart: 30, tEnd: 48 })]);
  });

  it("is named after the reason that held longer; other neither starts nor ends it", () => {
    const { problems } = run([
      { from: 30, to: 34, values: { out_limit: BANDWIDTH } },
      { from: 34, to: 44, values: { out_limit: CPU } },
      { from: 44, to: 50, values: { out_limit: OTHER } },
      { from: 60, to: 70, values: { out_limit: OTHER } },
    ]);

    expect(problems).toEqual([expect.objectContaining({ title: "Your upload limited by CPU", tStart: 30, tEnd: 50 })]);
  });

  it("ends when there is no outgoing video any more", () => {
    const { problems } = run([
      { from: 30, to: 40, values: { out_limit: CPU } },
      { from: 40, to: 81, values: { out_limit: null, out_bitrate: null, out_target: null } },
    ]);

    expect(problems).toEqual([expect.objectContaining({ tStart: 30, tEnd: 40 })]);
  });

  it("takes the highest target of the problem when it began with the session; leaves out what is unknown", () => {
    const { problems } = run([
      { from: 0, to: 20, values: { out_limit: BANDWIDTH, out_target: (t) => 300 + t * 50, out_bitrate: 250 } },
    ], { sender: { encoder: null, width: null, height: null } });

    expect(problems[0]).toMatchObject({ tStart: 0, tEnd: 20, oneLine: `bandwidth, 20 s, 250 of 1${NS}250 kbps` });
    expect(problems[0].card.rows[3]).toEqual(["Encoder", "—"]);

    const cpu = run([{ from: 10, to: 30, values: { out_limit: CPU, out_w: 480, out_h: 270, out_fps: null } }], { sender: { encoder: null, width: null, height: null } });
    expect(cpu.problems[0].card.rows[2]).toEqual(["Sent resolution", "480×270"]);
    expect(cpu.problems[0].card.likelyCause).toBe("This machine cannot encode 480×270 in real time.");
  });
});

describe("senderInfo", () => {
  const [stats] = loadSnapshots("two-way-cpu.json");
  const out = findStat(stats, "outbound-rtp", "video");
  const snapshot = (report = stats) => extract(toReport(report), {});

  it("is the captured size of the outgoing video and its encoder, if the browser tells it", () => {
    expect(senderInfo(snapshot())).toEqual({ encoder: null, width: 640, height: 360 });
    expect(senderInfo(snapshot(patchStat(stats, out.id, { encoderImplementation: "libvpx" })))).toEqual({ encoder: "libvpx", width: 640, height: 360 });
    expect(senderInfo(null)).toEqual({ encoder: null, width: null, height: null });
  });
});
