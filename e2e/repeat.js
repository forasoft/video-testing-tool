// npm run e2e:repeat [-- N] — the acceptance of PRD §1, criterion 2: every scenario with a problem (tests tagged
// @problem) N times (10 by default) without retries, then the table «problem — matches of N»: in how many runs the
// problem came with the cause the stand made. Exits with 1 when a row has fewer than 9 of 10.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const e2e = path.dirname(fileURLToPath(import.meta.url));
const times = Number(process.argv[2]) || 10;
const REQUIRED_SHARE = 0.9;
const checks = path.join(os.tmpdir(), `streamtest-e2e-checks-${process.pid}.jsonl`);

const started = Date.now();
const load = () => os.loadavg().map((v) => v.toFixed(1)).join(" ");
console.log(`e2e:repeat — every @problem scenario ×${times}, no retries; load average ${load()}`);
const run = spawnSync("npx", ["playwright", "test", "--grep", "@problem", `--repeat-each=${times}`, "--retries=0"], {
  cwd: e2e,
  stdio: "inherit",
  env: { ...process.env, E2E_CHECKS_FILE: checks },
});

const lines = fs.existsSync(checks)
  ? fs.readFileSync(checks, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line))
  : [];
fs.rmSync(checks, { force: true });

// A row per check, in the order the checks came; a run that did not get to a check is a miss too.
const rows = new Map();
lines.forEach(({
  name, ok, detail, repeat,
}) => {
  const row = rows.get(name) ?? {
    name, matches: 0, misses: [], runs: new Set(),
  };
  row.runs.add(repeat);
  if (ok) {
    row.matches += 1;
  } else {
    row.misses.push(`run ${repeat + 1}: ${detail}`);
  }
  rows.set(name, row);
});
rows.forEach((row) => {
  for (let repeat = 0; repeat < times; repeat++) {
    if (!row.runs.has(repeat)) {
      row.misses.push(`run ${repeat + 1}: the test failed before this check`);
    }
  }
});

const needed = Math.ceil(times * REQUIRED_SHARE);
const table = [...rows.values()];
console.log(`\n| Problem (scenario) | Matches of ${times} |\n|---|---|`);
table.forEach(({ name, matches }) => console.log(`| ${name} | ${matches}${matches < needed ? " ✗" : ""} |`));
const misses = table.filter((row) => row.misses.length);
if (misses.length) {
  console.log("\nMisses:");
  misses.forEach(({ name, misses: list }) => list.forEach((miss) => console.log(`- ${name} — ${miss}`)));
}
const minutes = ((Date.now() - started) / 60000).toFixed(1);
console.log(`\n${table.length} rows, ${minutes} min, Playwright exit ${run.status}, load average ${load()}`);

const passed = table.length > 0 && table.every(({ matches }) => matches >= needed);
console.log(passed ? `Every row has at least ${needed} of ${times}.` : `A row has fewer than ${needed} of ${times}.`);
process.exit(passed ? 0 : 1);
