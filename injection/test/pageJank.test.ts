import { describe, expect, it } from "vitest";
import { LongTask, LongTasks, observeLongTasks, TaskSource } from "src/session/longtasks";
import { Metrics } from "src/session/metrics";
import { PageJank } from "src/session/problems/pageJank";
import { makeSamples, runDetectors, Segment, STEADY } from "./makeSamples";

const NS = "\u202F";

// Tasks reported right after they end: at the sample t only those that ended by t are known.
const tasksOf = (list: [number, number][]) => {
  const tasks = new LongTasks();
  let now = 0;
  const source: TaskSource = (from, to) => tasks.between(from, to);
  const feed = (t: number) => {
    now = t;
    list.filter(([start, ms]) => start + ms / 1000 <= now && !tasks.tasks.some((task) => task.start === start))
      .forEach(([start, ms]) => tasks.add(start, ms));
  };
  return { tasks, source, feed };
};

const run = (list: [number, number][], segments: Segment[] = [], duration = 70) => {
  const { source, feed } = tasksOf(list);
  const samples = makeSamples({ duration, base: { ...STEADY, hidden: 0 }, segments });
  return runDetectors([new PageJank(source)], samples, { beforeSample: feed });
};

// PRD §12.3, problem 3.
describe("Page jank", () => {
  it("opens for a long task with the frame rate down and the network fine; ends 1 s after the task", () => {
    const { problems, sent } = run([[40.2, 400]], [{ from: 41, to: 42, values: { v_fps_r: 18 } }]);

    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatchObject({
      type: "page_jank",
      title: "Page jank",
      category: "Page",
      severity: "warn",
      tStart: 40.2,
      tEnd: 41.6,
      oneLine: "main thread blocked 400 ms",
    });
    expect(problems[0].card.rows).toEqual([
      ["Longest task", "400 ms"],
      ["Frame rate", "30.0 → 18.0 fps"],
      ["Packet loss / Bitrate / RTT", `0.00 % / 1${NS}500 kbps / 40 ms — normal`],
    ]);
    expect(problems[0].card.likelyCause).toBe("The page's JavaScript, not the stream: the main thread was busy for 400 ms while the network was fine.");
    expect(problems[0].card.check).toBe("Performance profile of the page around 0:40; heavy DOM updates or timers.");
    expect(problems[0].card.series).toEqual({ name: "longtask", kind: "bars", points: [[40.2, 400]] });
    // Found at 41, when it has lasted 0.8 s: shown at 42, once it is 1 s long — and already over.
    expect(sent[0]).toMatchObject({ open: false, tEnd: 41.6 });
  });

  it("takes the frame rate of the next second too", () => {
    const { problems } = run([[40.9, 400]], [{ from: 43, to: 44, values: { v_fps_r: 19 } }]);

    expect(problems).toEqual([expect.objectContaining({ tStart: 40.9, tEnd: 42.3, oneLine: "main thread blocked 400 ms" })]);
    expect(problems[0].card.rows[1]).toEqual(["Frame rate", "30.0 → 19.0 fps"]);
  });

  it("allows a bitrate dip of the task's second when the next one is normal (a sender in the same page)", () => {
    const { problems } = run([[40.2, 400]], [{ from: 41, to: 42, values: { v_fps_r: 18, v_bitrate: 500 } }, { from: 42, to: 43, values: { v_bitrate: 1700 } }]);

    expect(problems).toHaveLength(1);
    expect(problems[0].card.rows[2]).toEqual(["Packet loss / Bitrate / RTT", `0.00 % / 1${NS}700 kbps / 40 ms — normal`]);
  });

  it("is not a jank when the bitrate stays down: that is the network", () => {
    const { problems } = run([[40.2, 400]], [{ from: 41, to: 45, values: { v_fps_r: 18, v_bitrate: 500 } }]);

    expect(problems).toEqual([]);
  });

  it("is not a jank with packet loss of 1 % or more", () => {
    const { problems } = run([[40.2, 400]], [{ from: 41, to: 42, values: { v_fps_r: 18, v_loss: 1.5 } }]);

    expect(problems).toEqual([]);
  });

  it("is not a jank when the frame rate held", () => {
    const { problems } = run([[40.2, 400]], [{ from: 41, to: 42, values: { v_fps_r: 23 } }]);

    expect(problems).toEqual([]);
  });

  it("ignores tasks shorter than 200 ms, the first seconds and a hidden tab", () => {
    expect(run([[40.2, 150]], [{ from: 41, to: 42, values: { v_fps_r: 18 } }]).problems).toEqual([]);
    expect(run([[2.2, 400]], [{ from: 3, to: 4, values: { v_fps_r: 18 } }]).problems).toEqual([]);
    expect(run([[40.2, 400]], [{ from: 41, to: 42, values: { v_fps_r: 0, hidden: 0.6 } }]).problems).toEqual([]);
  });

  it("makes one problem of tasks closer than 1 s, and two of tasks further apart", () => {
    const close = run([[40.2, 400], [41.3, 300]], [{ from: 41, to: 43, values: { v_fps_r: 18 } }]);
    expect(close.problems).toEqual([expect.objectContaining({ tStart: 40.2, tEnd: 42.6, oneLine: "main thread blocked 400 ms" })]);
    expect(close.problems[0].card.series.points).toEqual([[40.2, 400], [41.3, 300]]);

    const apart = run([[40.2, 400], [50.2, 450]], [{ from: 41, to: 42, values: { v_fps_r: 18 } }, { from: 51, to: 52, values: { v_fps_r: 17 } }]);
    expect(apart.problems.map((p) => [p.id, p.tStart, p.tEnd, p.oneLine])).toEqual([
      [1, 40.2, 41.6, "main thread blocked 400 ms"],
      [2, 50.2, 51.65, "main thread blocked 450 ms"],
    ]);
  });
});

describe("long tasks", () => {
  it("keeps tasks in session seconds and gives the fields of a sample once", () => {
    const tasks = new LongTasks();
    tasks.add(10.25, 80.4);
    tasks.add(10.5, 400);

    expect(tasks.tasks).toEqual<LongTask[]>([{ start: 10.25, end: 10.33, duration: 80 }, { start: 10.5, end: 10.9, duration: 400 }]);
    expect(tasks.drain()).toEqual({ max: 400, sum: 480 });
    expect(tasks.drain()).toEqual({ max: 0, sum: 0 });
    expect(tasks.between(10.34, 11).map((t) => t.start)).toEqual([10.5]);
    expect(tasks.between(9, 10.3).map((t) => t.start)).toEqual([10.25]);
  });

  it("drops tasks older than the sample buffer", () => {
    const tasks = new LongTasks();
    tasks.add(5, 100);
    tasks.add(3700, 100);

    expect(tasks.tasks.map((t) => t.start)).toEqual([3700]);
  });

  it("is not observed where the browser does not report long tasks", () => {
    expect(observeLongTasks(new LongTasks(), (now) => now)).toBeNull();
  });

  it("puts the reported tasks into the sample, null without long tasks", () => {
    const metrics = new Metrics();

    expect(metrics.next({ longTasks: { max: 400, sum: 470 } }, 1)).toMatchObject({ longtask_max: 400, longtask_sum: 470 });
    expect(metrics.next({ longTasks: null }, 2)).toMatchObject({ longtask_max: null, longtask_sum: null });
  });
});
