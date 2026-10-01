import { describe, expect, it } from "vitest";
import { groupThousands, mmss } from "shared/format";
import { ProblemMessage, Severity } from "shared/protocol";
import { COLLECTING_S, sessionStatus } from "src/session/status";
import {
  degradedSeconds, problemDuration, verdict, worstProblem,
} from "src/session/verdict";

let nextId = 1;
const problem = (title: string, severity: Severity, tStart: number, tEnd: number | null, oneLine = "…"): ProblemMessage => ({
  id: nextId++,
  type: "test",
  title,
  category: "Network",
  severity,
  tStart,
  tEnd,
  open: tEnd === null,
  oneLine,
  card: { series: { name: "v_bitrate", points: [] }, rows: [], likelyCause: "", check: "" },
});

describe("format", () => {
  it("writes m:ss and groups thousands with a narrow space", () => {
    expect(mmss(0)).toBe("0:00");
    expect(mmss(12.7)).toBe("0:12");
    expect(mmss(100)).toBe("1:40");
    expect(mmss(3725)).toBe("62:05");
    expect(groupThousands(1546.4)).toBe("1\u202F546");
    expect(groupThousands(210)).toBe("210");
  });
});

describe("verdict", () => {
  it("is OK without problems", () => {
    expect(verdict([], 72)).toEqual({ level: "OK", degradedS: 0, worst: null, text: "No problems in 1:12" });
  });

  it("is Degraded with warn problems: Σ of their seconds, the longest one is the worst", () => {
    const drop = problem("Bandwidth drop", "warn", 38.5, 48.2, "bitrate 1 800 → 210 kbps, 1 freeze");
    const jank = problem("Page jank", "warn", 62, 62.5, "main thread blocked 480 ms");

    expect(verdict([drop, jank], 120)).toEqual({
      level: "Degraded",
      degradedS: 10.2,
      worst: drop.id,
      text: "Worst: Bandwidth drop at 0:38 — bitrate 1 800 → 210 kbps, 1 freeze",
    });
  });

  it("is Severe with any severe problem, which is worse than a longer warn one", () => {
    const long = problem("Bandwidth drop", "warn", 10, 40);
    const short = problem("Reconnection", "severe", 50, 53, "3.0 s");

    expect(verdict([long, short], 60)).toMatchObject({ level: "Severe", degradedS: 33, worst: short.id });
    expect(worstProblem([long, short], 60)).toBe(short);
  });

  it("counts the seconds with a problem once when problems overlap", () => {
    const drop = problem("Bandwidth drop", "severe", 20, 52);
    const freeze = problem("Video freeze", "warn", 23.3, 24.3);
    const stutter = problem("Audio stutter", "severe", 19, 30);
    const jank = problem("Page jank", "warn", 60, 61.5);

    // 19–52 and 60–61.5, not 32 + 1 + 11 + 1.5.
    expect(degradedSeconds([drop, freeze, stutter, jank], 70)).toBeCloseTo(34.5);
    expect(verdict([drop, freeze, stutter, jank], 70)).toMatchObject({ level: "Severe", degradedS: 34.5, worst: drop.id });
    // An open problem inside an ended one's span adds only what sticks out of it.
    expect(degradedSeconds([drop, problem("Reconnection", "severe", 50, null)], 57)).toBeCloseTo(37);
  });

  it("counts an open problem up to now", () => {
    const open = problem("Reconnection", "severe", 20, null);

    expect(problemDuration(open, 27.4)).toBeCloseTo(7.4);
    expect(verdict([open], 27.4).degradedS).toBe(7.4);
  });

  it("takes the earlier of two equal problems", () => {
    const first = problem("A", "warn", 5, 8);
    const second = problem("B", "warn", 20, 23);

    expect(worstProblem([first, second], 30)).toBe(first);
  });
});

describe("sessionStatus", () => {
  it("collects data for the first 5 s, then says there are no problems", () => {
    expect(sessionStatus([], 0, "live")).toEqual({ kind: "collecting", text: "Collecting data…", time: "0:00" });
    expect(sessionStatus([], COLLECTING_S - 0.1, "live").kind).toBe("collecting");
    expect(sessionStatus([], 12, "live")).toEqual({ kind: "ok", text: "No problems · 0:12", time: "0:12" });
  });

  it("names the worst problem going on now in its severity", () => {
    const warn = problem("Bandwidth drop", "warn", 30, null);
    const severe = problem("Reconnection", "severe", 40, null);

    expect(sessionStatus([warn], 35, "live")).toEqual({ kind: "now", text: "Bandwidth drop · now", time: "0:35", severity: "warn" });
    expect(sessionStatus([warn, severe], 45, "live")).toMatchObject({ text: "Reconnection · now", severity: "severe" });
    // A problem in the first seconds is shown instead of "Collecting data…".
    expect(sessionStatus([problem("Reconnection", "severe", 1, null)], 3, "live").kind).toBe("now");
  });

  it("counts past problems and the seconds since the last one ended, in the worst severity", () => {
    const one = [problem("Reconnection", "severe", 8, 16.1)];
    const three = [problem("A", "warn", 5, 9), problem("B", "severe", 20, 22), problem("C", "warn", 30, 44)];

    expect(sessionStatus(one, 21, "live")).toEqual({ kind: "past", text: "1 problem · last 5s ago", time: "0:21", severity: "severe" });
    expect(sessionStatus(three, 120, "live")).toMatchObject({ text: "3 problems · last 76s ago", severity: "severe" });
  });

  it("says the stream is gone once it is disconnected", () => {
    const open = problem("Reconnection", "severe", 70, null);

    expect(sessionStatus([open], 100, "disconnected")).toEqual({ kind: "disconnected", text: "Stream disconnected · 1:40", time: "1:40" });
  });
});
