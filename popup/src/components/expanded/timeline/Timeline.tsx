// The Timeline tab of Expanded: the session over time — its charts, events, and problems with their cards.
import React, {
  useContext, useEffect, useMemo, useRef, useState
} from "react";
import styles from "./Timeline.module.css";
import { DisplayContext } from "../../../context/DisplayContext";
import { FpsContext } from "../../../context/FpsContext";
import { SessionContext } from "../../../context/SessionContext";
import { TimelineContext } from "../../../context/TimelineContext";
import { groupThousands, mmss } from "../../../../../shared/format";
import { SampleValues } from "../../../../../shared/constants/sampleFields";
import { EventMessage, ProblemMessage, SampleMessage } from "../../../../../shared/protocol";
import {
  bitrateView, fpsView, lossView, MetricView, videoDelayView
} from "../../../utils/views";
import { hiddenRuns, mergeRanges } from "./bands";
import { ProblemCard } from "../ProblemCard";
import { problemEnd, problemsAt } from "../problems";
import { ProblemsList } from "../ProblemsList";
import { VerdictRow } from "../VerdictRow";
import { ChartOverlay, Cursor } from "./ChartOverlay";
import { EventsBand } from "./EventsBand";
import { NUMBER_R, numberCenters } from "./numbers";
import { ChartBand, ChartSeries, TimeChart } from "./TimeChart";
import {
  maxIn, nice, ticks, TimeWindow
} from "./scale";
import { delayStack, pointsOf } from "./series";
import { chartRows, historyRows, visibleRows } from "./rows";
import { nearestRow, rowSpan, tooltipLines } from "./tooltip";
import { useViewPerf } from "../../../utils/perf";
import { useHistory } from "./useHistory";
import { useWidth } from "./useWidth";
import { WindowControls } from "./WindowControls";
import {
  centerEdge, edgeOf, panEdge, spanOf, tickStep, visibleCenter, windowOf
} from "./window";

const AXIS_HEIGHT = 18;
// The label column and its gap: the plots start this far from the rows' left edge.
const LABEL_COLUMN_PX = 94;
// Delay above this is not good (PRD §7): a red dashed line on the Delay chart.
const DELAY_LIMIT_MS = 300;

// The current value of a row in its goodness color.
const LabelValue: React.FC<{ view: MetricView }> = ({ view }) => (
  <div className={`${styles.value} ${view.goodness ? styles[view.goodness] : ""}`} data-value>
    {view.value ?? "—"}
  </div>
);

// Frame rate's value comes four times a second (VTT_FPS): only it is drawn again then, not the charts.
const FpsLabelValue: React.FC<{ sample: SampleMessage | null }> = ({ sample }) => {
  const fps = useContext(FpsContext);
  return <LabelValue view={fpsView({ sample, fps })} />;
};

interface RowProps {
  name: string;
  // The current value under the name.
  value: React.ReactNode;
  children: React.ReactNode;
}

// A chart row: the 84 px label column (name, current value in its goodness color) and the plot.
const Row: React.FC<RowProps> = ({ name, value, children }) => (
  <div className={styles.row} data-row={name}>
    <div className={styles.label}>
      <div className={styles.name}>{name}</div>
      {value}
    </div>
    {children}
  </div>
);

// The m:ss labels under the charts every `step` seconds; the labels at the plot's edges keep inside it.
const TimeAxis: React.FC<{ window: TimeWindow; step: number }> = ({ window, step }) => {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const x = (t: number) => ((t - window.from) / (window.to - window.from)) * width;

  return (
    <div className={styles.row}>
      <div className={styles.label} />
      <div ref={ref} className={styles.plot} style={{ height: AXIS_HEIGHT }} data-time-axis>
        {width > 0 && (
          <svg width={width} height={AXIS_HEIGHT} aria-hidden="true">
            {ticks(window, step).map((t) => {
              const at = x(t);
              let anchor: "start" | "middle" | "end" = "middle";
              if (at < 14) {
                anchor = "start";
              } else if (at > width - 14) {
                anchor = "end";
              }
              return (
                <text key={t} className={styles.axisLabel} x={at} y={12} textAnchor={anchor}>{mmss(t)}</text>
              );
            })}
          </svg>
        )}
      </div>
    </div>
  );
};

interface ChartScale {
  max: number;
  series: ChartSeries[];
}

// The series of the four rows and the top of each scale (PRD §11.2), from the seconds the window shows.
const chartScales = (shown: SampleValues[], window: TimeWindow): Record<"bitrate" | "fps" | "loss" | "delay", ChartScale> => {
  const bitrate = pointsOf(shown, "v_bitrate");
  // The channel estimate, dashed — when the browser reports it.
  const channel = pointsOf(shown, "avail_in");
  const hasChannel = channel.some(({ v }) => v !== null);
  const fps = pointsOf(shown, "v_fps_r");
  const loss = pointsOf(shown, "v_loss");
  const delay = delayStack(shown);
  const bitrateSeries: ChartSeries[] = [{ key: "bitrate", points: bitrate, color: "var(--blue)", fill: 0.12 }];
  if (hasChannel) {
    bitrateSeries.push({ key: "channel", points: channel, color: "var(--gray)", line: 1.3, dashed: true });
  }
  return {
    bitrate: { max: Math.max(500, nice(maxIn(window, bitrate, hasChannel ? channel : []) * 1.2)), series: bitrateSeries },
    fps: {
      max: Math.max(34, nice(maxIn(window, fps) * 1.1)),
      series: [{ key: "fps", points: fps, color: "var(--green)", fill: 0.12 }],
    },
    loss: {
      max: Math.max(7, nice(maxIn(window, loss))),
      series: [{ key: "loss", points: loss, color: "var(--red)" }],
    },
    // The delay stack: the total, the jitter buffer and the network as layers, and the total's outline.
    delay: {
      max: nice(Math.max(maxIn(window, delay.total), DELAY_LIMIT_MS) * 1.15),
      series: [
        { key: "delay-total", points: delay.total, color: "var(--blue-faint)", fill: 1, line: 0 },
        { key: "delay-buffer", points: delay.buffer, color: "var(--blue-soft)", fill: 1, line: 0 },
        { key: "delay-net", points: delay.net, color: "var(--blue)", fill: 1, line: 0 },
        { key: "delay-outline", points: delay.total, color: "var(--blue)", line: 1.2 },
      ],
    },
  };
};

// Problems of the window as bands, the longer ones first so that the shorter ones are on top; the Bitrate row
// shows their numbers.
const problemBandsOf = (problems: ProblemMessage[], window: TimeWindow, now: number): ChartBand[] => problems
  .filter((p) => p.tStart <= window.to && problemEnd(p, now) >= window.from)
  .sort((a, b) => (problemEnd(b, now) - b.tStart) - (problemEnd(a, now) - a.tStart))
  .map((p) => ({
    key: `problem-${p.id}`, from: p.tStart, to: problemEnd(p, now), kind: p.severity, number: p.id,
  }));

// The cursor of the second under the pointer: its values, events and problems (PRD §11.3); null without one.
const cursorOf = (
  row: SampleValues | null,
  shown: SampleValues[],
  events: EventMessage[],
  problems: ProblemMessage[],
  now: number,
): Cursor | null => {
  if (!row) {
    return null;
  }
  const t = row.t as number;
  return { t, title: mmss(t), lines: tooltipLines(row, events, problems, rowSpan(shown, row), now) };
};

interface PickSource {
  bands: ChartBand[];
  problems: ProblemMessage[];
  window: TimeWindow;
  now: number;
}

// The problem a click on the plots opens: the one whose number in the Bitrate row is under the pointer, else the
// shortest problem under it; undefined when there is none. `at` — px from the plots' top-left, `width` — theirs.
const pickedProblem = (
  { bands, problems, window, now }: PickSource,
  t: number,
  at: { x: number; y: number },
  width: number,
): number | undefined => {
  const x = (time: number) => ((time - window.from) / (window.to - window.from)) * width;
  const visible = bands.filter(({ to: end }) => x(end) >= 0);
  const numbered = numberCenters(visible, x).find((center) => Math.hypot(at.x - center.x, at.y - center.y) <= NUMBER_R + 1);
  return numbered?.number ?? problemsAt(problems, t, now).at(0)?.id;
};

// A press outside the open card closes it (PRD §12.2).
const useCloseOutside = (open: number | null, close: () => void) => {
  useEffect(() => {
    if (open === null) {
      return undefined;
    }
    const onPress = (e: PointerEvent) => {
      if (!(e.target instanceof Element && e.target.closest("[data-problem-overlay]"))) {
        close();
      }
    };
    document.addEventListener("pointerdown", onPress);
    return () => document.removeEventListener("pointerdown", onPress);
  }, [open, close]);
};

interface DisconnectedBannerProps {
  // m:ss when the stream was lost.
  time: string;
  onPick: () => void;
}

// The stream is gone, its data stays (PRD §14.3); another one is picked from the start screen.
const DisconnectedBanner: React.FC<DisconnectedBannerProps> = ({ time, onPick }) => (
  <div className={styles.disconnected} role="status" data-disconnected-banner>
    <span className={styles.disconnectedText}>{`Stream disconnected at ${time}. Data kept.`}</span>
    <button type="button" className={styles.pickAnother} onClick={onPick} data-pick-another>
      Pick another stream
    </button>
  </div>
);

// Timeline tab, PRD §11: the verdict row with the window controls and the charts of the window — the
// samples the popup keeps, and the history the injection sends for older or longer windows.
export const Timeline: React.FC = () => {
  useViewPerf("timeline");
  const state = useContext(SessionContext);
  const {
    view: {
      range, live, end, open,
    }, setRange, goLive, pan, showProblem, closeProblem,
  } = useContext(TimelineContext);
  const {
    session, history: kept, sample, events, problems,
  } = state;
  const { setMainScreen } = useContext(DisplayContext);
  const now = sample?.t ?? 0;
  const edge = edgeOf(live, end, now);
  const window = windowOf(range, edge);
  const answer = useHistory(range, live, window, kept.length ? kept[0].t : null, now);
  // An answer comes every 5 s at most, the charts are drawn every second: its rows are made once.
  const answerRows = useMemo(() => (answer ? historyRows(answer) : null), [answer]);
  const shown = visibleRows(chartRows(kept, answerRows), window);
  // The right edge when a drag started.
  const dragFrom = useRef(edge);
  const chartsRef = useRef<HTMLDivElement>(null);
  const chartsWidth = useWidth(chartsRef);
  // The second under the pointer: it stays while the window moves under a still pointer.
  const [hovered, setHovered] = useState<number | null>(null);
  const cursor = cursorOf(hovered === null ? null : nearestRow(shown, hovered, window), shown, events, problems, now);
  // The tab was hidden or the video paused: the history's ranges and the kept seconds.
  const hidden: ChartBand[] = mergeRanges([...(answer?.hiddenRanges ?? []), ...hiddenRuns(shown)])
    .map(([from, to]) => ({ key: `hidden-${from}`, from, to, kind: "hidden" }));
  const problemBands = problemBandsOf(problems, window, now);
  const bands = [...hidden, ...problemBands.map((band) => ({ ...band, number: undefined }))];
  const openProblem = problems.find((p) => p.id === open) ?? null;

  // A problem's card opens with the window centered on the problem and Live off (PRD §11.3): in
  // the middle of the part of the plots that the card leaves visible.
  const show = (id: number) => {
    const problem = problems.find((p) => p.id === id);
    if (problem) {
      const share = visibleCenter(chartsWidth - LABEL_COLUMN_PX);
      showProblem(id, centerEdge(problem.tStart, problemEnd(problem, now), range, now, share));
    }
  };

  const pick = (t: number, at: { x: number; y: number }, width: number) => {
    const id = pickedProblem({
      bands: problemBands, problems, window, now,
    }, t, at, width);
    if (id !== undefined) {
      show(id);
    }
  };

  useCloseOutside(open, closeProblem);

  const scales = chartScales(shown, window);

  const span = spanOf(range);

  return (
    <div className={styles.timeline}>
      <VerdictRow verdict={sample?.verdict} state={state.session?.state}>
        <WindowControls range={range} live={live} onRange={setRange} onLive={goLive} />
      </VerdictRow>
      <div className={styles.card} data-timeline data-window={`${window.from}-${window.to}`}>
        <div ref={chartsRef} className={styles.charts}>
          <Row name="Bitrate" value={<LabelValue view={bitrateView({ sample, fps: null })} />}>
            <TimeChart
              window={window}
              height={96}
              bands={[...hidden, ...problemBands]}
              max={scales.bitrate.max}
              series={scales.bitrate.series}
              labels={[
                { value: scales.bitrate.max, text: groupThousands(scales.bitrate.max) },
                { value: scales.bitrate.max / 2, text: groupThousands(scales.bitrate.max / 2) },
              ]}
            />
          </Row>
          <Row name="Frame rate" value={<FpsLabelValue sample={sample} />}>
            <TimeChart
              window={window}
              height={56}
              max={scales.fps.max}
              bands={bands}
              series={scales.fps.series}
              labels={[{ value: scales.fps.max, text: groupThousands(scales.fps.max) }]}
            />
          </Row>
          <Row name="Packet loss" value={<LabelValue view={lossView({ sample, fps: null })} />}>
            <TimeChart
              window={window}
              height={56}
              max={scales.loss.max}
              bands={bands}
              series={scales.loss.series}
              labels={[{ value: scales.loss.max, text: `${groupThousands(scales.loss.max)} %` }]}
            />
          </Row>
          <Row name="Delay" value={<LabelValue view={videoDelayView({ sample, fps: null })} />}>
            <TimeChart
              window={window}
              height={84}
              bands={bands}
              max={scales.delay.max}
              series={scales.delay.series}
              labels={[{ value: scales.delay.max, text: groupThousands(scales.delay.max) }]}
              limit={{ value: DELAY_LIMIT_MS, text: `${DELAY_LIMIT_MS} ms` }}
            />
          </Row>
          <ChartOverlay
            window={window}
            draggable={panEdge(edge, -1, now, span) !== edge || edge < now}
            onDragStart={() => {
              dragFrom.current = edge;
            }}
            onDrag={(dt) => {
              const next = panEdge(dragFrom.current, dt, now, span);
              if (next !== edge) {
                pan(next);
              }
            }}
            onHover={(t) => {
              const row = t === null ? null : nearestRow(shown, t, window);
              setHovered(row ? row.t : null);
            }}
            onPick={pick}
            cursor={cursor}
          />
        </div>
        <TimeAxis window={window} step={tickStep(range, window)} />
        <EventsBand window={window} events={events} />
        {openProblem && (
          <div className={styles.problemOverlay} data-problem-overlay>
            <ProblemCard problem={openProblem} now={now} onClose={closeProblem} />
          </div>
        )}
      </div>
      <ProblemsList
        problems={problems}
        now={now}
        onOpen={show}
        banner={session?.state === "disconnected" && (
          <DisconnectedBanner time={sample?.status?.time ?? mmss(now)} onPick={() => setMainScreen(true)} />
        )}
      />
    </div>
  );
};
