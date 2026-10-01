import * as fs from "fs";
import * as path from "path";
import { RtpStats } from "src/session/extract";

export type StatsList = RtpStats[];

// Fixture files hold `snapshots`: getStats() reports of the stand, one per second.
export const loadSnapshots = (name: string): StatsList[] =>
  (JSON.parse(fs.readFileSync(path.resolve(__dirname, "fixtures", name), "utf8")) as { snapshots: StatsList[] }).snapshots;

export const toReport = (stats: StatsList): RTCStatsReport => new Map(stats.map((stat) => [stat.id, stat]));

export const findStat = (stats: StatsList, type: string, kind?: string): RtpStats =>
  stats.find((stat) => stat.type === type && (!kind || stat.kind === kind)) as RtpStats;

// A copy of the report with fields of one stat replaced.
export const patchStat = (
  stats: StatsList,
  id: string,
  patch: Record<string, unknown>
): StatsList => stats.map((stat) => (stat.id === id ? { ...stat, ...patch } : stat));
