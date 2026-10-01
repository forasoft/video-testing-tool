import { describe, expect, it, vi } from "vitest";
import { SampleBuffer } from "src/session/buffer";
import { emptySample } from "src/session/metrics";
import {
  LastRuns, parseRun, previousRunLine, RunSummary, runSummary,
} from "src/session/lastRun";
import { reportStats } from "src/session/report";

const run = (patch: Partial<RunSummary> = {}): RunSummary => ({
  startedAt: "2026-09-25T09:00:00.000Z",
  durationS: 120,
  verdict: "Degraded",
  degradedS: 9.7,
  freezes: 3,
  p95DelayMs: 610,
  p95LossPct: 5.1,
  p50BitrateKbps: 1290,
  ...patch,
});

const text = (parts: { text: string }[]) => parts.map((p) => p.text).join("");
const colored = (parts: { text: string; change?: string }[]) => parts.filter((p) => p.change).map((p) => [p.text, p.change]);

describe("runSummary (PRD §13.1)", () => {
  it("keeps the numbers of the line with its precision", () => {
    const buffer = new SampleBuffer();
    for (let t = 0; t <= 40; t++) {
      buffer.push({
        ...emptySample(), t, hidden: 0, v_bitrate: 1290.4, d_video: t === 40 ? 700 : 142.6, v_loss: t === 40 ? 6.26 : 0.2,
      });
    }
    const stats = reportStats({
      buffer, t: 40.37, freezes: [{ start: 3, end: 4.2 }, { start: 9, end: 9.3 }], suspended: [], firstFrameS: 0.2,
    });
    const verdict = {
      level: "Degraded" as const, degradedS: 9.66, worst: 1, text: "",
    };

    expect(runSummary(Date.UTC(2026, 8, 25, 9, 0, 0), 40.37, verdict, stats)).toEqual({
      startedAt: "2026-09-25T09:00:00.000Z",
      durationS: 40.4,
      verdict: "Degraded",
      degradedS: 9.7,
      freezes: 2,
      p95DelayMs: 143,
      p95LossPct: 0.2,
      p50BitrateKbps: 1290,
    });
    expect(runSummary(0, 31, { level: "OK", degradedS: 0, worst: null, text: "" }, reportStats({
      buffer: new SampleBuffer(), t: 31, freezes: [], suspended: [], firstFrameS: null,
    }))).toMatchObject({ verdict: "OK", degradedS: 0, freezes: 0, p95DelayMs: null, p95LossPct: null, p50BitrateKbps: null });
  });

  it("reads back only a stored summary", () => {
    expect(parseRun(JSON.stringify(run()))).toEqual(run());
    expect(parseRun(JSON.stringify(run({ p95DelayMs: null })))).toEqual(run({ p95DelayMs: null }));
    expect(parseRun("null")).toBeNull();
    expect(parseRun(JSON.stringify({ ...run(), verdict: "Great" }))).toBeNull();
    expect(parseRun(JSON.stringify({ ...run(), freezes: "3" }))).toBeNull();
    expect(parseRun("{broken")).toBeNull();
    expect(parseRun({ ...run() })).toBeNull();
  });
});

describe("previousRunLine (PRD §13.1)", () => {
  it("names the level again when it changed; values that got better are green", () => {
    const parts = previousRunLine(run(), run({
      verdict: "OK", degradedS: 0, freezes: 0, p95DelayMs: 512, p95LossPct: 3.9,
    }));

    expect(text(parts)).toBe("Previous run on this site: Degraded 9.7 s → OK 0 s · freezes 3 → 0 · p95 delay 610 → 512 ms · p95 loss 5.1 → 3.9 %");
    expect(colored(parts)).toEqual([["OK 0 s", "better"], ["0", "better"], ["512", "better"], ["3.9", "better"]]);
  });

  it("compares Σ within one level, and a worse level is worse whatever Σ", () => {
    const same = previousRunLine(run({ degradedS: 14.2 }), run({ degradedS: 9.7, freezes: 5, p95DelayMs: 700 }));
    expect(text(same)).toBe("Previous run on this site: Degraded 14.2 s → 9.7 s · freezes 3 → 5 · p95 delay 610 → 700 ms · p95 loss 5.1 → 5.1 %");
    expect(colored(same)).toEqual([["9.7 s", "better"], ["5", "worse"], ["700", "worse"]]);

    const worse = previousRunLine(run({ verdict: "OK", degradedS: 0 }), run({ verdict: "Severe", degradedS: 3 }));
    expect(colored(worse)[0]).toEqual(["Severe 3.0 s", "worse"]);
    const lower = previousRunLine(run({ verdict: "Severe", degradedS: 3 }), run({ verdict: "Degraded", degradedS: 30 }));
    expect(colored(lower)[0]).toEqual(["Degraded 30.0 s", "better"]);
  });

  it("groups thousands as everywhere", () => {
    const parts = previousRunLine(run({ p95DelayMs: 3446 }), run({ p95DelayMs: 1074 }));

    expect(text(parts)).toContain("p95 delay 3\u202F446 → 1\u202F074 ms");
  });

  it("does not color what is unknown", () => {
    const parts = previousRunLine(run({ p95DelayMs: null }), run({ p95LossPct: null }));

    expect(text(parts)).toBe("Previous run on this site: Degraded 9.7 s → 9.7 s · freezes 3 → 3 · p95 delay — → 610 ms · p95 loss 5.1 → — %");
    expect(colored(parts)).toEqual([]);
  });
});

describe("LastRuns", () => {
  it("gives a session the stored run once main.js answers", () => {
    const store = vi.fn();
    const runs = new LastRuns(store);
    const update = vi.fn();

    expect(runs.forSession(update)).toBeNull();
    runs.loaded(run());
    expect(update).toHaveBeenCalledWith(run());
    expect(runs.latest).toEqual(run());
    expect(store).not.toHaveBeenCalled();
  });

  it("prefers what this page saved: it is newer than storage", () => {
    const store = vi.fn();
    const runs = new LastRuns(store);
    const mine = run({ verdict: "Severe", degradedS: 40 });

    runs.save(mine);
    expect(store).toHaveBeenCalledWith(mine);
    const update = vi.fn();
    expect(runs.forSession(update)).toEqual(mine);
    // A late answer of storage does not replace it, and the session does not wait for it.
    runs.loaded(run());
    expect(runs.latest).toEqual(mine);
    expect(update).not.toHaveBeenCalled();
  });
});
