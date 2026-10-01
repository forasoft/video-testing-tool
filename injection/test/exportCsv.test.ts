import { describe, expect, it } from "vitest";
import { SAMPLE_FIELDS } from "shared/constants/sampleFields";
import { ProblemMessage } from "shared/protocol";
import { SampleBuffer } from "src/session/buffer";
import { csvCell, EVENT_COLUMNS, PROBLEM_COLUMNS, sessionCsv } from "src/session/export/csv";
import { exportMedia, ExportSource } from "src/session/export/json";
import { emptySample } from "src/session/metrics";
import { reportStats } from "src/session/report";

const problem = (id: number, tEnd: number | null, oneLine: string): ProblemMessage => ({
  id,
  type: "bandwidth_drop",
  title: "Bandwidth drop",
  category: "Network",
  severity: "severe",
  tStart: 3.5,
  tEnd,
  open: tEnd === null,
  oneLine,
  card: {
    series: { name: "v_bitrate", points: [] },
    rows: [],
    likelyCause: "Network between you and the sender: packet loss spiked to 6.2 %.",
    check: "Wi-Fi/VPN on this machine. If it happens to everyone at once — SFU or the sender's uplink.",
  },
});

const source = (): ExportSource => {
  const buffer = new SampleBuffer();
  for (let t = 0; t < 3; t++) {
    const s = emptySample();
    s.t = t;
    s.v_bitrate = t === 0 ? null : 1546.23456 * t;
    s.av_offset = -17.25;
    buffer.push(s);
  }
  return {
    extensionVersion: "1.0.0",
    startedAt: 0,
    endedAt: null,
    durationS: 9.25,
    state: "live",
    origin: "http://localhost:8080",
    url: "http://localhost:8080/",
    hostname: "localhost",
    userAgent: "Chrome",
    buffer,
    events: [
      {
        n: 1, t: 0.05, kind: "first_frame", label: "First frame 0.05 s", tone: "green",
      },
      {
        n: 2, t: 6, kind: "layer_change", label: "720p → 360p", tone: "yellow",
      },
    ],
    problems: [problem(1, 8.2, "bitrate 1 800 → 210 kbps, 1 freeze"), problem(2, null, "say \"hi\"")],
    verdict: {
      level: "Severe", degradedS: 10.4, worst: 1, text: "",
    },
    report: reportStats({
      buffer, t: 9.25, freezes: [], suspended: [], firstFrameS: 0.05,
    }),
    previousRun: null,
    streams: [],
    ...exportMedia(null, null),
    sdp: { local: null, remote: null },
  };
};

// RFC 4180 fields of one line.
const parse = (line: string): string[] => {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === "\"" && line[i + 1] === "\"") {
        cell += "\"";
        i += 1;
      } else if (c === "\"") {
        quoted = false;
      } else {
        cell += c;
      }
    } else if (c === "\"") {
      quoted = true;
    } else if (c === ",") {
      cells.push(cell);
      cell = "";
    } else {
      cell += c;
    }
  }
  cells.push(cell);
  return cells;
};

// CSV export, PRD §15.2.
describe("CSV export", () => {
  it("is UTF-8 with a BOM, CRLF lines, three sections split by an empty line", () => {
    const text = sessionCsv(source());

    expect(text.startsWith("﻿# samples\r\n")).toBe(true);
    expect(text.endsWith("\r\n")).toBe(true);
    const lines = text.slice(1).split("\r\n");
    expect(lines.filter((line) => line.startsWith("# "))).toEqual(["# samples", "# events", "# problems"]);
    expect(lines[lines.indexOf("# events") - 1]).toBe("");
    expect(lines[lines.indexOf("# problems") - 1]).toBe("");
  });

  it("has a row per second with every field of §6.3 in order, empty for no data", () => {
    const lines = sessionCsv(source()).slice(1).split("\r\n");

    expect(lines[1]).toBe(SAMPLE_FIELDS.join(","));
    const rows = lines.slice(2, lines.indexOf("")).map(parse);
    expect(rows).toHaveLength(3);
    expect(rows.every((cells) => cells.length === SAMPLE_FIELDS.length)).toBe(true);
    const column = (field: string) => rows.map((cells) => cells[SAMPLE_FIELDS.indexOf(field as typeof SAMPLE_FIELDS[number])]);
    expect(column("t")).toEqual(["0", "1", "2"]);
    expect(column("v_bitrate")).toEqual(["", "1546.235", "3092.469"]);
    expect(column("av_offset")).toEqual(["-17.25", "-17.25", "-17.25"]);
    expect(column("d_video")).toEqual(["", "", ""]);
  });

  it("lists events as t,kind,label", () => {
    const lines = sessionCsv(source()).slice(1).split("\r\n");
    const at = lines.indexOf("# events");

    expect(lines.slice(at + 1, at + 4)).toEqual([EVENT_COLUMNS.join(","), "0.05,first_frame,First frame 0.05 s", "6,layer_change,720p → 360p"]);
  });

  it("lists problems with their texts; an open one has no end and lasts until the export", () => {
    const lines = sessionCsv(source()).slice(1).split("\r\n");
    const at = lines.indexOf("# problems");

    expect(lines[at + 1]).toBe(PROBLEM_COLUMNS.join(","));
    expect(parse(lines[at + 2])).toEqual([
      "1", "bandwidth_drop", "Network", "severe", "3.5", "8.2", "4.7", "bitrate 1 800 → 210 kbps, 1 freeze",
      "Network between you and the sender: packet loss spiked to 6.2 %.",
      "Wi-Fi/VPN on this machine. If it happens to everyone at once — SFU or the sender's uplink.",
    ]);
    expect(parse(lines[at + 3]).slice(0, 8)).toEqual(["2", "bandwidth_drop", "Network", "severe", "3.5", "", "5.8", "say \"hi\""]);
    // A comma or a quote in a text puts it in quotes.
    expect(lines[at + 2]).toContain(",\"bitrate 1 800 → 210 kbps, 1 freeze\",");
    expect(lines[at + 3]).toContain(",\"say \"\"hi\"\"\",");
  });

  it("quotes a cell only when it has to", () => {
    expect(csvCell(null)).toBe("");
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell("a,b")).toBe("\"a,b\"");
    expect(csvCell("a\nb")).toBe("\"a\nb\"");
    expect(csvCell("plain → text")).toBe("plain → text");
  });
});
