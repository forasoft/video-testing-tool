import { describe, expect, it } from "vitest";
import { FpsMessage, SampleMessage } from "shared/protocol";
import { emptySample } from "src/session/metrics";
import { fpsView, freezesView, lossView, ViewSource } from "../../popup/src/utils/views";

const sample = (patch: Partial<SampleMessage> = {}): SampleMessage => ({
  t: 30,
  values: {
    ...emptySample(), t: 30, v_fps_r: 29.5, v_freeze_pct: 1.25, v_loss: 0.4,
  },
  goodness: { fps: "good", freezes: "moderate", loss: "good" },
  ...patch,
});

const state = (s: SampleMessage | null, fps: FpsMessage | null = null): ViewSource => ({ sample: s, fps });

describe("tile views", () => {
  it("show the values and colors of the sample and of VTT_FPS", () => {
    expect(fpsView(state(sample()))).toEqual({ value: "29.5 fps", goodness: "good" });
    expect(fpsView(state(sample(), { fps: 30, goodness: "good" }))).toEqual({ value: "30.0 fps", goodness: "good" });
    expect(freezesView(state(sample()))).toEqual({ value: "1.25 %", goodness: "moderate" });
  });

  it("show `—` and the reason in Frame rate and Freezes & Stalls while no frames are rendered (PRD §14.4)", () => {
    const paused = state(sample({ suspended: "paused" }));
    expect(fpsView(paused)).toEqual({ value: null, suspended: "paused" });
    expect(freezesView(paused)).toEqual({ value: null, suspended: "paused" });
    // The other tiles keep their values.
    expect(lossView(paused)).toEqual({ value: "0.40 %", goodness: "good" });

    // VTT_FPS comes four times a second: it tells first that the tab was hidden or shown again.
    const hidden = state(sample(), { fps: 0, goodness: "bad", suspended: "hidden" });
    expect(fpsView(hidden)).toEqual({ value: null, suspended: "hidden" });
    expect(freezesView(hidden)).toEqual({ value: null, suspended: "hidden" });
    const shown = state(sample({ suspended: "hidden" }), { fps: 12, goodness: "bad" });
    expect(fpsView(shown)).toEqual({ value: "12.0 fps", goodness: "bad" });
    expect(freezesView(shown)).toEqual({ value: "1.25 %", goodness: "moderate" });
  });
});
