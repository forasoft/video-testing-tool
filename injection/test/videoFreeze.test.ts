import { describe, expect, it } from "vitest";
import { ListedFreeze } from "src/session/frames";
import { LongTasks, TaskSource } from "src/session/longtasks";
import { BandwidthDrop } from "src/session/problems/bandwidthDrop";
import { FreezeSource, MediaState, VideoFreeze } from "src/session/problems/videoFreeze";
import { makeSamples, runDetectors, Segment, STEADY } from "./makeSamples";

const NS = " ";
const BASE = { ...STEADY, a_bitrate: 32 };

// Freezes as frames.ts lists them at t: ended ones, and the one going on (seen once it is longer
// than the rVFC threshold).
const freezesOf = (intervals: [number, number][]): FreezeSource => (t) =>
  intervals.flatMap(([start, end]): ListedFreeze[] => {
    if (end <= t) {
      return [{ start, end, open: false }];
    }
    return t - start > 0.2 ? [{ start, end: t, open: true }] : [];
  });

interface Options {
  freezes: [number, number][] | FreezeSource;
  segments?: Segment[];
  duration?: number;
  // Seconds with no packets on the selected pair: [from, to).
  silent?: [number, number];
  media?: Partial<MediaState>;
  // Long tasks of the page, [start, ms]; without them long tasks are not reported.
  tasks?: [number, number][];
}

const run = ({ freezes, segments = [], duration = 70, silent, media = {}, tasks }: Options) => {
  let now = 0;
  const state = (): MediaState => {
    const quiet = silent && now >= silent[0] && now < silent[1];
    return { readyState: 4, decoder: "libvpx", lastPacketT: quiet ? (silent as [number, number])[0] : now - 0.02, ...media };
  };
  const source = typeof freezes === "function" ? freezes : freezesOf(freezes);
  const longTasks = new LongTasks();
  (tasks ?? []).forEach(([start, ms]) => longTasks.add(start, ms));
  // A task is known once it has ended.
  const taskSource: TaskSource | undefined = tasks && ((from, to) => longTasks.between(from, to).filter((task) => task.end <= now));
  const detector = new VideoFreeze(source, state, taskSource);
  const samples = makeSamples({ duration, base: BASE, segments });
  return runDetectors([detector], samples, { beforeSample: (t) => { now = t; } });
};

// No frames from 40.3 s to 43.4 s: the samples at 41 and 44 hold the frames of 40.0–40.3 and 43.4–44.0.
const frames = (recv: number, dec: number, rendered = 0): Segment[] => [
  { from: 41, to: 42, values: { v_fps_r: 9, v_fps_recv: 9 + recv * 0.7, v_fps_dec: 9 + dec * 0.7 } },
  { from: 42, to: 44, values: { v_fps_r: rendered, v_fps_recv: recv, v_fps_dec: dec } },
  { from: 44, to: 45, values: { v_fps_r: 18, v_fps_recv: 18 + recv * 0.4, v_fps_dec: 18 + dec * 0.4 } },
];
const SOURCE_FROZEN: Segment[] = [...frames(0, 0), { from: 41, to: 44, values: { v_bitrate: 0 } }];

describe("Video freeze", () => {
  it("is unknown when the sender stops sending: audio and RTCP keep coming, nothing before it", () => {
    const { problems, sent } = run({ freezes: [[40.3, 43.4]], segments: SOURCE_FROZEN });

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      id: 1,
      type: "video_freeze",
      title: "Video freeze",
      category: "Device",
      severity: "severe",
      tStart: 40.3,
      tEnd: 43.4,
      open: false,
      oneLine: "3.1 s, unknown",
    });
    expect(problems[0].card.rows).toEqual([
      ["Duration", "3.1 s"],
      ["Frames received / decoded / rendered", "0 / 0 / 0"],
      ["Packet loss before", "0.0 %"],
      ["Bitrate before", `1${NS}500 kbps`],
      ["Longest page task", "—"],
    ]);
    expect(problems[0].card.likelyCause).toBe("No network or page anomaly around the freeze.");
    expect(problems[0].card.check).toBe("Compare with the sender's side at 0:40.");
    expect(problems[0].card.series.name).toBe("v_fps_r");
    // Shown once it lasted 1 s, warn until 3 s.
    expect(sent[0]).toMatchObject({ open: true, severity: "warn", oneLine: "1.7 s, unknown" });
  });

  it("is network when no packet came over the pair for 2 s during it, though loss did not grow", () => {
    const { problems } = run({
      freezes: [[40.3, 46.5]],
      silent: [40.3, 43.3],
      segments: [{ from: 41, to: 47, values: { v_fps_r: 0, v_fps_recv: 0, v_fps_dec: 0, v_bitrate: 0, a_bitrate: 0 } }],
    });

    expect(problems[0]).toMatchObject({ category: "Network", severity: "severe", oneLine: "6.2 s, network" });
    expect(problems[0].card.likelyCause).toBe("Packets stopped arriving: loss 0.0 %, bitrate fell to 0 kbps.");
    expect(problems[0].card.check).toBe("Same as Bandwidth drop.");
  });

  it("is not network for a pause in packets shorter than 2 s", () => {
    const { problems } = run({ freezes: [[40.3, 43.4]], silent: [40.3, 42.2], segments: SOURCE_FROZEN });

    expect(problems[0].oneLine).toBe("3.1 s, unknown");
  });

  it("is network after packet loss in the 3 s before it", () => {
    const { problems } = run({
      freezes: [[40.3, 41.8]],
      segments: [{ from: 38, to: 42, values: { v_loss: 5 } }, { from: 41, to: 42, values: { v_fps_r: 9, v_bitrate: 700 } }],
    });

    expect(problems[0]).toMatchObject({ category: "Network", severity: "warn", oneLine: "1.5 s, network" });
    expect(problems[0].card.rows[2]).toEqual(["Packet loss before", "5.0 %"]);
    expect(problems[0].card.likelyCause).toBe("Packets stopped arriving: loss 5.0 %, bitrate fell to 700 kbps.");
  });

  it("is network after the bitrate fell under half of its median in the 3 s before it", () => {
    const { problems } = run({
      freezes: [[40.3, 42.4]],
      segments: [{ from: 39, to: 43, values: { v_bitrate: 600 } }, { from: 41, to: 43, values: { v_fps_r: 0 } }],
    });

    expect(problems[0]).toMatchObject({ category: "Network", oneLine: "2.1 s, network" });
    // Median of 1 500, 600, 600.
    expect(problems[0].card.rows[3]).toEqual(["Bitrate before", "600 kbps"]);
  });

  it("is decoder when frames kept arriving and none was decoded", () => {
    const { problems } = run({ freezes: [[40.3, 43.4]], segments: frames(30, 0), media: { decoder: "ExternalDecoder (VideoToolbox)" } });

    expect(problems[0]).toMatchObject({ category: "Device", oneLine: "3.1 s, decoder" });
    expect(problems[0].card.rows[1]).toEqual(["Frames received / decoded / rendered", "93 / 0 / 0"]);
    expect(problems[0].card.likelyCause).toBe("Frames arrived but the decoder produced none — decoder stall.");
    expect(problems[0].card.check).toBe("Decoder: ExternalDecoder (VideoToolbox); try disabling hardware decoding.");
  });

  it("is element when frames kept being decoded but none was shown", () => {
    const { problems } = run({ freezes: [[40.3, 43.4]], segments: frames(30, 30), media: { readyState: 2 } });

    expect(problems[0]).toMatchObject({ category: "Device", oneLine: "3.1 s, element" });
    expect(problems[0].card.rows[1]).toEqual(["Frames received / decoded / rendered", "93 / 93 / 0"]);
    expect(problems[0].card.likelyCause).toBe("Frames were decoded but the video element did not show them.");
    expect(problems[0].card.check).toBe("Is the element paused, hidden, or covered? readyState was 2.");
  });

  it("is page when a long task of 200 ms or more falls into it, before any other cause", () => {
    const { problems } = run({
      freezes: [[40.3, 43.4]],
      silent: [40.3, 43.3],
      segments: [...SOURCE_FROZEN, { from: 38, to: 42, values: { v_loss: 5 } }],
      tasks: [[39.5, 120], [41.2, 420], [42.5, 250]],
    });

    expect(problems[0]).toMatchObject({ category: "Page", severity: "severe", oneLine: "3.1 s, page" });
    expect(problems[0].card.rows[4]).toEqual(["Longest page task", "420 ms"]);
    expect(problems[0].card.likelyCause).toBe("The page's JavaScript blocked the main thread for 420 ms; the browser could not paint.");
    expect(problems[0].card.check).toBe("Profile the page's main thread around 0:41.");
  });

  it("is not page for shorter tasks; the card shows the longest one, or none", () => {
    const short = run({ freezes: [[40.3, 43.4]], segments: SOURCE_FROZEN, tasks: [[41, 150]] });
    expect(short.problems[0].oneLine).toBe("3.1 s, unknown");
    expect(short.problems[0].card.rows[4]).toEqual(["Longest page task", "150 ms"]);

    const none = run({ freezes: [[40.3, 43.4]], segments: SOURCE_FROZEN, tasks: [[20, 400]] });
    expect(none.problems[0].card.rows[4]).toEqual(["Longest page task", "none"]);
  });

  it("drops a freeze shorter than 1 s", () => {
    expect(run({ freezes: [[40.3, 41.1]] }).problems).toEqual([]);
  });

  it("takes a freeze that began and ended between two samples", () => {
    const late: FreezeSource = (t) => (t >= 42 ? [{ start: 40.4, end: 41.6, open: false }] : []);
    const { problems } = run({ freezes: late, segments: [{ from: 41, to: 43, values: { v_fps_r: 12, v_fps_recv: 12, v_fps_dec: 12 } }] });

    expect(problems).toEqual([expect.objectContaining({ tStart: 40.4, tEnd: 41.6, severity: "warn", oneLine: "1.2 s, unknown" })]);
  });

  it("makes a problem of each freeze", () => {
    const { problems } = run({ freezes: [[20.5, 22], [22.3, 23.5], [40.3, 43.4]] });

    expect(problems.map(({ id, tStart, tEnd }) => ({ id, tStart, tEnd }))).toEqual([
      { id: 1, tStart: 20.5, tEnd: 22 },
      { id: 2, tStart: 22.3, tEnd: 23.5 },
      { id: 3, tStart: 40.3, tEnd: 43.4 },
    ]);
  });

  it("makes a Bandwidth drop around it severe and counted", () => {
    const samples = makeSamples({
      duration: 70,
      base: { ...BASE, v_bitrate: 2000 },
      segments: [{ from: 38, to: 48, values: { v_bitrate: 250, v_loss: 8 } }, { from: 41, to: 44, values: { v_fps_r: 0 } }],
    });
    const { problems } = runDetectors([new BandwidthDrop(), new VideoFreeze(freezesOf([[40.3, 43.4]]), () => ({ readyState: 4, decoder: null, lastPacketT: null }))], samples);

    expect(problems.find((p) => p.type === "bandwidth_drop")).toMatchObject({
      severity: "severe",
      oneLine: `bitrate 2${NS}000 → 250 kbps, 1 freeze`,
    });
    expect(problems.find((p) => p.type === "video_freeze")).toMatchObject({ category: "Network", oneLine: "3.1 s, network" });
  });
});
