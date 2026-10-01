// Checks of the problems a scenario must give (plan §3). With E2E_CHECKS_FILE set (`npm run e2e:repeat`), every check
// is appended to that file as a line of JSON — the table «matches of 10» of PRD §1, criterion 2, is counted from them.
import fs from "node:fs";
import { expect, test } from "@playwright/test";

export const recordCheck = (name, ok, detail) => {
  const file = process.env.E2E_CHECKS_FILE;
  if (file) {
    const info = test.info();
    fs.appendFileSync(file, `${JSON.stringify({
      name, ok, detail, test: info.title, repeat: info.repeatEachIndex, retry: info.retry,
    })}\n`);
  }
};

// Waits for a problem of the type and checks the cause its card names: the category and, by `oneLine`, the cause of a
// Video freeze or the reason of Upload limited; `severity` too when the scenario fixes it. `name` — its row in the
// table of e2e:repeat. `timeout` — ms from now.
export const expectProblem = async (stand, {
  name, type, category, oneLine, severity, timeout, ok,
}) => {
  let problem = null;
  let error = null;
  try {
    problem = await stand.waitForProblem(type, { timeout, ok });
  } catch (e) {
    error = e;
  }
  const matched = problem !== null && problem.category === category && (!oneLine || oneLine.test(problem.oneLine))
    && (!severity || problem.severity === severity);
  recordCheck(name, matched, problem ? `${problem.title} · ${problem.category} · ${problem.severity} · ${problem.oneLine}` : "none");
  if (error) {
    throw error;
  }
  expect(problem.category, `${problem.title}: ${problem.oneLine}`).toBe(category);
  if (oneLine) {
    expect(problem.oneLine).toMatch(oneLine);
  }
  if (severity) {
    expect(problem.severity).toBe(severity);
  }
  return problem;
};

// Only problems of these types were found.
export const expectOnly = async (stand, allowed) => {
  const types = [...new Set(((await stand.problems()) ?? []).map((p) => p.type))];
  expect(types.filter((type) => !allowed.includes(type)), `problems: ${types.join(", ")}`).toEqual([]);
};
