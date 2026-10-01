import { describe, expect, it } from "vitest";
import { BandwidthDrop, MAX_S } from "src/session/problems/bandwidthDrop";
import { Detector } from "src/session/problems/engine";
import { makeSamples, runDetectors, Segment, STEADY } from "./makeSamples";

const NS = "\u202F";
const BASE = { ...STEADY, v_bitrate: 2000, v_h: 720, rtt: 5 };

const run = (segments: Segment[], duration = 100, extra: Detector[] = []) =>
  runDetectors([new BandwidthDrop(), ...extra], makeSamples({ duration, base: BASE, segments }));

// The stand's Throttle 300 kbit 10 s: loss while throttled, then the sender's slow ramp-up with
// layers 720p → 540p → 360p and back.
const THROTTLE: Segment[] = [
  { from: 36, to: 46, values: { v_bitrate: 250, v_loss: 15, v_nack: 20, rtt: 600 } },
  { from: 38, to: 39, values: { v_bitrate: 133 } },
  { from: 46, to: 100, values: { v_bitrate: (t) => Math.min(2000, 200 + (t - 46) * 30) } },
  { from: 47, to: 51, values: { v_h: 540 } },
  { from: 51, to: 76, values: { v_h: 360 } },
  { from: 76, to: 86, values: { v_h: 540 } },
];

describe("Bandwidth drop", () => {
  it("opens on the first low sample with loss, ends when the layer switches up, severe after a layer drop", () => {
    const { problems, sent } = run(THROTTLE);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      type: "bandwidth_drop",
      title: "Bandwidth drop",
      category: "Network",
      severity: "severe",
      tStart: 36,
      tEnd: 76,
      open: false,
      oneLine: `bitrate 2${NS}000 → 133 kbps, layer 720p → 360p`,
    });
    expect(problems[0].card.rows).toEqual([
      ["Bitrate", `2${NS}000 → 133 kbps`],
      ["Packet loss", "max 15.0 %"],
      ["NACK / PLI", "200 / 0"],
      ["RTT", "5 → 600 ms"],
      ["Layer", "720p → 360p"],
      ["Recovery", "10 s to 720p"],
    ]);
    expect(problems[0].card.likelyCause).toBe("Network between you and the sender: packet loss spiked to 15.0 %.");
    expect(problems[0].card.check).toBe("Wi-Fi/VPN on this machine. If it happens to everyone at once — SFU or the sender's uplink.");
    expect(problems[0].card.series.name).toBe("v_bitrate");
    expect(problems[0].card.dashed).toBeUndefined();
    // warn until the layer went down, then severe; "not yet" recovered until 720p came back.
    expect(sent[0]).toMatchObject({ severity: "warn", oneLine: `bitrate 2${NS}000 → 250 kbps`, open: true });
    expect(sent.find((m) => !m.open)?.card.rows[5]).toEqual(["Recovery", "not yet"]);
  });

  it("ignores a lower bitrate without loss, PLI or a falling channel estimate (the sender capped it)", () => {
    expect(run([{ from: 30, to: 100, values: { v_bitrate: 300 } }]).problems).toEqual([]);
  });

  it("starts on PLIs and ends when the bitrate is back to 80 % for 5 samples, warn without a layer change", () => {
    const { problems } = run([
      { from: 40, to: 50, values: { v_bitrate: 500 } },
      { from: 40, to: 42, values: { v_pli: 1 } },
      { from: 50, to: 52, values: { v_bitrate: 1500 } },
    ]);

    expect(problems).toEqual([
      expect.objectContaining({ tStart: 40, tEnd: 52, severity: "warn", oneLine: `bitrate 2${NS}000 → 500 kbps` }),
    ]);
    expect(problems[0].card.rows).toEqual([
      ["Bitrate", `2${NS}000 → 500 kbps`],
      ["Packet loss", "max 0.0 %"],
      ["NACK / PLI", "0 / 2"],
      ["RTT", "5 → 5 ms"],
      ["Layer", "unchanged"],
    ]);
  });

  it("starts on a falling channel estimate and names it as the cause", () => {
    const drop: Segment = { from: 40, to: 50, values: { v_bitrate: 400, avail_in: 400 } };
    // Without an estimate before the drop there is nothing to compare with.
    expect(run([drop], 70).problems).toEqual([]);

    const samples = makeSamples({ duration: 70, base: { ...BASE, avail_in: 2400 }, segments: [drop] });
    const { problems } = runDetectors([new BandwidthDrop()], samples);

    expect(problems[0]).toMatchObject({ tStart: 40, tEnd: 50, severity: "warn" });
    expect(problems[0].card.likelyCause).toBe("Network between you and the sender: channel estimate fell 2.4 → 0.4 Mbit/s.");
    expect(problems[0].card.dashed?.name).toBe("avail_in");
  });

  it("needs two low samples in a row", () => {
    expect(run([{ from: 40, to: 41, values: { v_bitrate: 100, v_loss: 30 } }]).problems).toEqual([]);
  });

  it("does not judge the first seconds without a 5-sample baseline", () => {
    expect(run([{ from: 2, to: 5, values: { v_bitrate: 100, v_loss: 30 } }], 40).problems).toEqual([]);
  });

  it("ends after 120 s at most", () => {
    const { problems } = run([{ from: 20, to: 300, values: { v_bitrate: 300, v_loss: 5 } }], 300);

    expect(problems[0]).toMatchObject({ tStart: 20, tEnd: 20 + MAX_S, open: false });
    expect(problems).toHaveLength(1);
  });

  it("is severe and counts the video freezes inside it", () => {
    // Stand-in for the Video freeze detector (T1.11): a freeze at 40–43 s.
    const freeze: Detector = {
      type: "video_freeze",
      onSample(engine) {
        if (engine.t === 40) {
          engine.open("video_freeze", 40, {});
        }
        const open = engine.current("video_freeze");
        if (open && engine.t === 43) {
          engine.close(open, 43);
        }
      },
      describe: () => ({
        title: "Video freeze", category: "Network", severity: "severe", oneLine: "",
        card: { series: { name: "v_fps_r", points: [] }, rows: [], likelyCause: "", check: "" },
      }),
    };
    const { problems } = run([{ from: 38, to: 48, values: { v_bitrate: 250, v_loss: 8 } }], 70, [freeze]);
    const drop = problems.find((p) => p.type === "bandwidth_drop");

    expect(drop).toMatchObject({ severity: "severe", oneLine: `bitrate 2${NS}000 → 250 kbps, 1 freeze` });
  });
});
