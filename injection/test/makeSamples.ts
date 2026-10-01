// Sample sequences for detector tests: a baseline plus segments that override fields for a while.
import { SampleField, SampleValues } from "shared/constants/sampleFields";
import { ConnectionInfo } from "shared/protocol";
import { SampleBuffer } from "src/session/buffer";
import { EventLog, SampleEvents } from "src/session/events";
import { emptySample } from "src/session/metrics";
import { Detector, ProblemEngine, Signal } from "src/session/problems/engine";

// A value, or a function of the second (for ramps and noise); null — no data.
export type FieldValue = number | null | ((t: number) => number | null);

export type Values = Partial<Record<SampleField, FieldValue>>;

export interface Segment {
  // Seconds, from ≤ t < to.
  from: number;
  to: number;
  values: Values;
}

export interface SampleScript {
  // Samples at t = 0, 1, …, duration.
  duration: number;
  base: Values;
  segments?: Segment[];
}

// A steady call: 720p, 1 500 kbps, no loss, 40 ms RTT, relay over udp.
export const STEADY: Values = {
  v_bitrate: 1500,
  v_fps_r: 30,
  v_fps_dec: 30,
  v_fps_recv: 30,
  v_w: 1280,
  v_h: 720,
  v_loss: 0,
  v_nack: 0,
  v_pli: 0,
  rtt: 40,
  pair_type: 3,
  pair_proto: 0,
  pair_changes: 1,
};

const apply = (sample: SampleValues, values: Values, t: number) => {
  (Object.keys(values) as SampleField[]).forEach((field) => {
    const value = values[field] as FieldValue;
    sample[field] = typeof value === "function" ? value(t) : value;
  });
};

export const makeSamples = ({ duration, base, segments = [] }: SampleScript): SampleValues[] => {
  const samples: SampleValues[] = [];
  for (let t = 0; t <= duration; t++) {
    const sample = emptySample();
    apply(sample, base, t);
    segments.filter((s) => t >= s.from && t < s.to).forEach((s) => apply(sample, s.values, t));
    sample.t = t;
    samples.push(sample);
  }
  return samples;
};

// Signals to deliver before the sample with the same or a later t.
export interface RunOptions {
  signals?: Signal[];
  onEnd?: (reason: string) => void;
  // Called with the sample's t before the engine sees it (for sources of detectors).
  beforeSample?: (t: number) => void;
  // The connection chip and line data of the sample's second.
  connection?: (t: number) => ConnectionInfo | undefined;
}

// Feeds samples (and signals in time order) through the event detectors and a problem engine,
// as the session does.
export const runDetectors = (detectors: Detector[], samples: SampleValues[], {
  signals = [], onEnd, beforeSample, connection,
}: RunOptions = {}) => {
  const buffer = new SampleBuffer();
  const events = new EventLog();
  const sampleEvents = new SampleEvents(events);
  const sent: ReturnType<ProblemEngine["list"]> = [];
  const engine = new ProblemEngine({ buffer, events, detectors, send: (m) => sent.push(m), onEnd });
  const pending = [...signals].sort((a, b) => a.t - b.t);

  samples.forEach((sample) => {
    while (pending.length && pending[0].t <= (sample.t as number)) {
      engine.signal(pending.shift() as Signal);
    }
    buffer.push(sample);
    sampleEvents.onSample(sample);
    beforeSample?.(sample.t as number);
    engine.onSample(sample, connection?.(sample.t as number));
  });
  pending.forEach((signal) => engine.signal(signal));

  return { engine, events, sent, problems: engine.list() };
};
