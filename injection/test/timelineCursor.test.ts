import { describe, expect, it } from "vitest";
import { SampleValues } from "shared/constants/sampleFields";
import { EventMessage, ProblemMessage } from "shared/protocol";
import { emptySample } from "src/session/metrics";
import {
  cursorLines, eventNames, nearestRow, problemNames, rowSpan
} from "../../popup/src/components/expanded/timeline/tooltip";

const sample = (t: number, values: Partial<SampleValues> = {}): SampleValues => ({ ...emptySample(), t, ...values });

// Popup's timeline cursor (PRD §11.3): the second under the pointer and its tooltip.
describe("timeline cursor", () => {
  it("takes the row inside the window closest to the pointer's time", () => {
    const rows = [10, 11, 12, 13].map((t) => sample(t));
    const window = { from: 10.5, to: 13 };

    expect(nearestRow(rows, 11.4, window)?.t).toBe(11);
    expect(nearestRow(rows, 11.6, window)?.t).toBe(12);
    // The row before the window is not under the cursor.
    expect(nearestRow(rows, 9, window)?.t).toBe(11);
    expect(nearestRow([], 11, window)).toBeNull();
  });

  it("shows the values of the row with the delay split into the layers of its chart", () => {
    const row = sample(62, {
      v_bitrate: 1546.4, v_fps_r: 29.96, v_loss: 0.214, d_video: 138.4, d_net: 21.2, d_jb: 92.3, d_decode: 16.6, d_render: 8.3,
    });

    expect(cursorLines(row)).toEqual([
      "Bitrate 1 546 kbps",
      "Frame rate 30.0 fps",
      "Packet loss 0.21 %",
      "Delay 138 ms — network 21 · buffer 92 · decode 25",
    ]);
  });

  it("shows a dash for a value the second does not have", () => {
    expect(cursorLines(sample(3))).toEqual(["Bitrate —", "Frame rate —", "Packet loss —", "Delay —"]);
    // Delay without RTT yet: the network part is unknown.
    expect(cursorLines(sample(4, { d_video: 110, d_jb: 95, d_decode: 10, d_render: 5 }))[3])
      .toBe("Delay 110 ms — network — · buffer 95 · decode 15");
  });

  it("stands a row for the time since the row before it: a second, a bucket, at most 10 s", () => {
    const seconds = [10, 11, 12].map((t) => sample(t));
    const buckets = [0, 5, 10].map((t) => sample(t));
    const gap = [sample(10), sample(40)];

    expect(rowSpan(seconds, seconds[1])).toEqual([10, 11]);
    expect(rowSpan(seconds, seconds[0])).toEqual([9, 10]);
    expect(rowSpan(buckets, buckets[2])).toEqual([5, 10]);
    expect(rowSpan(gap, gap[1])).toEqual([30, 40]);
  });

  it("names the events and the problems of the hovered second", () => {
    const events: EventMessage[] = [
      { n: 1, t: 9.4, kind: "tab_hidden", label: "Tab hidden", tone: "gray" },
      { n: 2, t: 10, kind: "mark", label: "Mark 1", tone: "blue" },
      { n: 3, t: 10.2, kind: "tab_visible", label: "Tab visible", tone: "gray" },
    ];
    const problem = (id: number, title: string, tStart: number, tEnd: number | null) => ({
      id, title, tStart, tEnd,
    }) as ProblemMessage;
    const problems = [problem(1, "Bandwidth drop", 5, 9.5), problem(2, "Video freeze", 8, 9), problem(3, "Reconnection", 9.8, null)];

    expect(eventNames(events, [9, 10])).toEqual(["Tab hidden", "Mark 1"]);
    // Going on until now (12 s).
    expect(problemNames(problems, [9, 10], 12)).toEqual(["Bandwidth drop", "Reconnection"]);
    expect(problemNames(problems, [11, 12], 12)).toEqual(["Reconnection"]);
  });
});
