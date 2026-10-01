import { describe, expect, it } from "vitest";
import { SampleValues } from "shared/constants/sampleFields";
import { EventMessage } from "shared/protocol";
import { emptySample } from "src/session/metrics";
import { hiddenRuns, mergeRanges } from "../../popup/src/components/expanded/timeline/bands";
import { groupEvents, groupLabel, groupTone } from "../../popup/src/components/expanded/timeline/eventGroups";

const sample = (t: number, hidden: number | null): SampleValues => ({ ...emptySample(), t, hidden });

const event = (n: number, t: number, tone: EventMessage["tone"] = "gray"): EventMessage => ({
  n, t, kind: "mark", label: `Mark ${n}`, tone,
});

// Popup's timeline: gray bands of a hidden tab or a paused video, and the events band (PRD §11.2).
describe("timeline gray bands", () => {
  it("turns runs of hidden seconds into ranges with the hidden share at their ends", () => {
    // Paused at 10.3 s, playing again at 13.3 s.
    const rows = [sample(9, 0), sample(10, 0), sample(11, 0.7), sample(12, 1), sample(13, 1), sample(14, 0.3), sample(15, 0)];
    const [[start, end]] = hiddenRuns(rows);

    expect(start).toBeCloseTo(10.3, 9);
    expect(end).toBeCloseTo(13.3, 9);
  });

  it("keeps separate runs apart, ends a lone second at its time and skips seconds without data", () => {
    const rows = [sample(1, 0.5), sample(2, 0), sample(3, 1), sample(4, 1), sample(5, null), sample(6, 1)];

    expect(hiddenRuns(rows)).toEqual([[0.5, 1], [2, 4], [5, 6]]);
    expect(hiddenRuns([sample(1, 0), sample(2, null)])).toEqual([]);
  });

  it("joins overlapping ranges in time order", () => {
    const ranges: [number, number][] = [[20, 30], [2, 5], [4, 8], [30, 31], [40, 41]];

    expect(mergeRanges(ranges)).toEqual([[2, 8], [20, 31], [40, 41]]);
    // The input is left as it was.
    expect(ranges[1]).toEqual([2, 5]);
  });
});

describe("timeline events band", () => {
  const x = (t: number) => t * 10;

  it("puts events closer than 16 px to a group's first one into that group", () => {
    const groups = groupEvents([event(3, 5.1), event(1, 1), event(2, 2.4), event(4, 9)], x);

    expect(groups.map((g) => [g.x, g.events.map((e) => e.n)])).toEqual([[10, [1, 2]], [51, [3]], [90, [4]]]);
    expect(groups.map(groupLabel)).toEqual(["+2", "3", "4"]);
  });

  it("colors a circle by its events' kind, gray when they differ", () => {
    const [same, mixed] = groupEvents([event(1, 1, "blue"), event(2, 1.2, "blue"), event(3, 5, "green"), event(4, 5.5, "yellow")], x);

    expect(groupTone(same)).toBe("blue");
    expect(groupTone(mixed)).toBe("gray");
  });
});
