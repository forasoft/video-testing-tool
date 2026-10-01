// CSV export of a session (PRD §15.2): three sections — a row per second with every field of §6.3,
// the events and the problems. UTF-8 with a BOM, so that Excel reads `→` and narrow spaces.
import { SAMPLE_FIELDS } from "shared/constants/sampleFields";
import { ExportSource, exportSamples } from "./json";

// U+FEFF, invisible here: Excel reads the file as UTF-8 only with it.
const BOM = "﻿";
// RFC 4180 line breaks; Numbers and Excel read them as well as LF.
const EOL = "\r\n";

// Header rows of the events and problems sections.
export const EVENT_COLUMNS = ["t", "kind", "label"];
export const PROBLEM_COLUMNS = ["id", "type", "category", "severity", "t_start", "t_end", "duration_s", "one_line", "likely_cause", "check"];

// Empty for no data; quoted when it holds a comma, a quote or a line break.
export const csvCell = (value: string | number | null): string => {
  if (value === null) {
    return "";
  }
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, "\"\"")}"` : text;
};

const row = (cells: (string | number | null)[]): string => cells.map(csvCell).join(",");

const tenths = (s: number) => Math.round(s * 10) / 10;

// The CSV text: `# samples`, `# events` and `# problems` sections; sample values rounded as in the JSON.
export const sessionCsv = (source: ExportSource): string => {
  const samples = exportSamples(source.buffer);
  const lines = ["# samples", row([...SAMPLE_FIELDS])];
  for (let i = 0; i < source.buffer.size; i++) {
    lines.push(row(SAMPLE_FIELDS.map((field) => samples[field][i])));
  }

  lines.push("", "# events", row(EVENT_COLUMNS));
  source.events.forEach(({ t, kind, label }) => lines.push(row([t, kind, label])));

  lines.push("", "# problems", row(PROBLEM_COLUMNS));
  source.problems.forEach((p) => lines.push(row([
    p.id,
    p.type,
    p.category,
    p.severity,
    p.tStart,
    p.tEnd,
    // A problem that goes on lasts until the end of the export.
    tenths((p.tEnd ?? Math.max(source.durationS, p.tStart)) - p.tStart),
    p.oneLine,
    p.card.likelyCause,
    p.card.check,
  ])));

  return BOM + lines.join(EOL) + EOL;
};
