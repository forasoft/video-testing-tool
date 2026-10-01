import { describe, expect, it } from "vitest";
import { EventMessage, ProblemMessage } from "shared/protocol";
import { addEvents, addProblems } from "../../popup/src/context/sessionStore";
import {
  problemDuration, problemInterval, problemsAt
} from "../../popup/src/components/expanded/problems";
import { numberCenters } from "../../popup/src/components/expanded/timeline/numbers";

const problem = (id: number, tStart: number, tEnd: number | null, title = "Bandwidth drop"): ProblemMessage => ({
  id,
  type: "bandwidth_drop",
  title,
  category: "Network",
  severity: "warn",
  tStart,
  tEnd,
  open: tEnd === null,
  oneLine: "",
  card: { series: { name: "v_bitrate", points: [] }, rows: [], likelyCause: "", check: "" },
});

const event = (n: number, kind: EventMessage["kind"] = "tab_hidden"): EventMessage => ({
  n, t: n, kind, label: kind, tone: "gray",
});

// Popup's problems and events (PRD §6.4, §11.4).
describe("popup session store", () => {
  it("keeps events by number, adding only new ones", () => {
    const events = addEvents([event(1), event(3)], [event(2), event(3)]);

    expect(events.map((e) => e.n)).toEqual([1, 2, 3]);
    expect(addEvents(events, [event(2)])).toBe(events);
  });

  it("drops the oldest events beyond 2000, never a mark", () => {
    const first = addEvents([], [event(1, "mark"), ...Array.from({ length: 1999 }, (_, i) => event(i + 2))]);
    const events = addEvents(first, [event(2001), event(2002)]);

    expect(events).toHaveLength(2000);
    expect(events.slice(0, 2).map((e) => e.n)).toEqual([1, 4]);
  });

  it("replaces a problem by its own message; a history answer only adds unknown ones", () => {
    const open = [problem(1, 10, null)];
    const updated = addProblems(open, [problem(1, 10, 20), problem(2, 30, null)], true);

    expect(updated.map((p) => [p.id, p.tEnd])).toEqual([[1, 20], [2, null]]);
    // History: its problem 1 is older than the popup's own.
    expect(addProblems(updated, [problem(1, 10, null), problem(3, 40, 41)], false).map((p) => [p.id, p.tEnd])).toEqual([[1, 20], [2, null], [3, 41]]);
    expect(addProblems(updated, [problem(1, 10, null)], false)).toBe(updated);
  });

  it("drops the oldest ended problems beyond 200", () => {
    const many = Array.from({ length: 200 }, (_, i) => problem(i + 1, i, i + 0.5));
    const problems = addProblems(many, [problem(201, 300, null)], true);

    expect(problems).toHaveLength(200);
    expect(problems[0].id).toBe(2);
    expect(problems[199].id).toBe(201);
  });
});

describe("problem rows", () => {
  it("shows the interval, a start only for a problem under 1 s, and now while it goes on", () => {
    expect(problemInterval(problem(1, 38.4, 48.1))).toBe("0:38–0:48");
    expect(problemInterval(problem(1, 62.2, 62.9))).toBe("1:02");
    expect(problemInterval(problem(1, 76.5, null))).toBe("1:16–now");
  });

  it("shows the duration with one decimal, up to now while the problem goes on", () => {
    expect(problemDuration(problem(1, 38.4, 48.1), 60)).toBe("9.7 s");
    expect(problemDuration(problem(1, 76.5, null), 80)).toBe("3.5 s");
  });

  it("finds the problems under a moment, the shortest one first", () => {
    const drop = problem(1, 38, 72);
    const freeze = problem(2, 45, 48, "Video freeze");
    const open = problem(3, 90, null, "Reconnection");

    expect(problemsAt([drop, freeze, open], 46, 100).map((p) => p.id)).toEqual([2, 1]);
    expect(problemsAt([drop, freeze, open], 60, 100).map((p) => p.id)).toEqual([1]);
    expect(problemsAt([drop, freeze, open], 99, 100).map((p) => p.id)).toEqual([3]);
    expect(problemsAt([drop, freeze, open], 80, 100)).toEqual([]);
  });
});

describe("problem numbers", () => {
  const x = (t: number) => t * 10;

  it("puts a number in its band's top-left corner, moved right past a number it would cover", () => {
    // Reconnection and its freeze start 50 ms apart; a band from before the window starts at 0 px.
    const centers = numberCenters([
      { from: 101.393, number: 4 },
      { from: 101.345, number: 5 },
      { from: 30, number: 2 },
      { from: -5, number: 1 },
      { from: 60 },
    ], x);

    expect(centers.map(({ number, x: at }) => [number, Math.round(at * 10) / 10])).toEqual([
      [1, 9], [2, 309], [5, 1022.5], [4, 1038.5],
    ]);
    expect(centers.every(({ y }) => y === 9)).toBe(true);
  });
});
