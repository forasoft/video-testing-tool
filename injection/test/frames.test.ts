import { describe, expect, it } from "vitest";
import { FrameClock, RESUME_GUARD_MS } from "src/session/frames";

const FRAME = 1000 / 30;

// Feeds frames at 30 fps from `from` (inclusive) to `to` (exclusive), returns the last frame time.
const play = (clock: FrameClock, from: number, to: number, latency: number | null = null): number => {
  let t = from;
  let last = from;
  while (t < to) {
    clock.frame(t, latency);
    last = t;
    t += FRAME;
  }
  return last;
};

describe("FrameClock", () => {
  it("counts 30 frames a second on a steady 30 fps stream, without freezes", () => {
    const clock = new FrameClock();
    const last = play(clock, 0, 5000);

    // The window is (t − 1 s, t]: read it between two frames.
    expect(clock.fps(last + 1)).toBe(30);
    expect(clock.freezes(last)).toEqual([]);
    expect(clock.freezeMs(last)).toBe(0);
    expect(clock.firstFrame).toBe(0);
  });

  it("records a 2 s gap as one freeze interval, also while it is still going on", () => {
    const clock = new FrameClock();
    const before = play(clock, 0, 3000);

    // During the gap: no frames in the last second, the freeze is open.
    expect(clock.fps(before + 1500)).toBe(0);
    expect(clock.freezeMs(before + 1500)).toBeCloseTo(1500, 6);

    const resumed = before + 2000;
    const last = play(clock, resumed, resumed + 2000);

    expect(clock.freezes(last)).toEqual([{ start: before, end: resumed }]);
    expect(clock.freezeMs(last)).toBeCloseTo(2000, 6);
    expect(clock.fps(last + 1)).toBe(30);
  });

  it("does not count short gaps below max(3 × mean, mean + 150 ms)", () => {
    const clock = new FrameClock();
    const before = play(clock, 0, 2000);
    // 170 ms < mean + 150 ms = 183 ms
    const last = play(clock, before + 170, before + 1000);

    expect(clock.freezes(last)).toEqual([]);
  });

  it("ignores a gap while the tab is hidden and the first 200 ms after it returns", () => {
    const clock = new FrameClock();
    const before = play(clock, 0, 3000);

    clock.suspend("hidden", before + 10);
    expect(clock.freezeMs(before + 5000)).toBe(0);
    clock.resume("hidden", before + 8000);

    // Frames settle during the guard with a 198 ms gap: a freeze anywhere else (threshold 183 ms).
    clock.frame(before + 8001);
    clock.frame(before + 8001 + RESUME_GUARD_MS - 2);
    const last = play(clock, before + 8001 + RESUME_GUARD_MS + 30, before + 10000);

    expect(clock.freezes(last)).toEqual([]);
  });

  it("counts a freeze after the guard is over", () => {
    const clock = new FrameClock();
    const before = play(clock, 0, 3000);
    clock.suspend("hidden", before + 10);
    clock.resume("hidden", before + 1000);
    const settled = play(clock, before + 1020, before + 2000);
    const last = play(clock, settled + 1500, settled + 2500);

    expect(clock.freezes(last)).toEqual([{ start: settled, end: settled + 1500 }]);
  });

  it("counts a stall that goes on after the tab returns, from the end of the guard", () => {
    const clock = new FrameClock();
    const before = play(clock, 0, 3000);
    clock.suspend("hidden", before + 10);
    const back = before + 5000;
    clock.resume("hidden", back);

    // No frame since the return: a freeze from the end of the guard once it is longer than the threshold (183 ms).
    expect(clock.freezes(back + RESUME_GUARD_MS + 100)).toEqual([]);
    expect(clock.freezes(back + 2000)).toEqual([{ start: back + RESUME_GUARD_MS, end: back + 2000 }]);

    // The first frame ends it; the frames after it count as usual.
    const last = play(clock, back + 3000, back + 4000);
    expect(clock.freezes(last)).toEqual([{ start: back + RESUME_GUARD_MS, end: back + 3000 }]);
  });

  it("ignores a gap while the video is paused", () => {
    const clock = new FrameClock();
    const before = play(clock, 0, 3000);

    clock.suspend("paused", before + 5);
    clock.resume("paused", before + 3000);
    const last = play(clock, before + 3030, before + 5000);

    expect(clock.freezes(last)).toEqual([]);
  });

  it("stays suspended until both the tab is visible and the video plays", () => {
    const clock = new FrameClock();
    const before = play(clock, 0, 3000);

    clock.suspend("hidden", before + 5);
    clock.suspend("paused", before + 6);
    clock.resume("hidden", before + 1000);
    expect(clock.freezeMs(before + 3000)).toBe(0);
    clock.resume("paused", before + 3000);
    const last = play(clock, before + 3010, before + 5000);

    expect(clock.freezes(last)).toEqual([]);
  });

  it("says why frames are not counted now: a hidden tab before a paused video", () => {
    const clock = new FrameClock();
    const before = play(clock, 0, 3000);
    expect(clock.suspendReason()).toBeNull();

    clock.suspend("paused", before + 5);
    expect(clock.suspendReason()).toBe("paused");
    clock.suspend("hidden", before + 6);
    expect(clock.suspendReason()).toBe("hidden");
    clock.resume("hidden", before + 1000);
    expect(clock.suspendReason()).toBe("paused");
    clock.resume("paused", before + 3000);
    // The 200 ms after the video plays again only do not count as a freeze: frames are counted.
    expect(clock.suspendReason()).toBeNull();
  });

  it("keeps the part of a freeze that happened before the tab was hidden", () => {
    const clock = new FrameClock();
    const before = play(clock, 0, 3000);

    clock.suspend("hidden", before + 1200);
    clock.resume("hidden", before + 5000);
    const last = play(clock, before + 5010, before + 6000);

    expect(clock.freezes(last)).toEqual([{ start: before, end: before + 1200 }]);
  });

  it("counts presented frames when one callback covers several of them", () => {
    // 20 fps video, the page renders only every other frame: callbacks every 100 ms, 2 frames each.
    const clock = new FrameClock();
    let presented = 0;
    for (let t = 0; t < 5000; t += 100) {
      presented += 2;
      clock.frame(t, null, presented);
    }

    expect(clock.fps(4901)).toBe(20);
    expect(clock.freezes(4901)).toEqual([]);
  });

  it("does not take a long callback gap for a freeze when frames were presented meanwhile", () => {
    const clock = new FrameClock();
    let presented = 0;
    let t = 0;
    for (; t < 3000; t += FRAME) {
      presented += 1;
      clock.frame(t, null, presented);
    }
    // 400 ms without callbacks, but 12 frames were shown.
    presented += 12;
    clock.frame(t + 400, null, presented);

    expect(clock.freezes(t + 401)).toEqual([]);
  });

  it("keeps the freeze before a burst of frames", () => {
    const clock = new FrameClock();
    let presented = 0;
    let t = 0;
    let last = 0;
    for (; t < 3000; t += FRAME) {
      presented += 1;
      clock.frame(t, null, presented);
      last = t;
    }
    // Nothing for 2 s, then two frames at once.
    presented += 2;
    clock.frame(last + 2000, null, presented);

    const [freeze] = clock.freezes(last + 2001);
    expect(freeze.start).toBe(last);
    expect(freeze.end).toBeCloseTo(last + 2000 - FRAME, 3);
  });

  it("averages presentationTime − receiveTime over the last second", () => {
    const clock = new FrameClock();
    play(clock, 0, 1000, 10);
    const last = play(clock, 1000, 2000, 20);

    expect(clock.latency(last)).toBeCloseTo(20, 6);
    expect(new FrameClock().latency(0)).toBeNull();
  });

  it("remembers the first frame time", () => {
    const clock = new FrameClock();
    play(clock, 1840, 3000);

    expect(clock.firstFrame).toBe(1840);
  });
});
