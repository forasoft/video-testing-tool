// Other streams on this page (PRD §13.4): every video track the page receives, numbered in the order it appeared,
// with its resolution, bitrate, loss and share of freezes. Polled every 5 s: getStats() of each other connection
// once, and for the selected connection the report the session has just read — it is not asked twice (PRD §18).
// The selected stream's row shows the values of its tiles.
import { SampleValues } from "shared/constants/sampleFields";
import { Goodness, GoodnessMap, StreamRow } from "shared/protocol";
import { findInbound, RtpStats } from "./extract";
import {
  bitrateGoodness, freezesGoodness, lossGoodness, resolutionGoodness,
} from "./goodness";
import { bitrateKbps, delta } from "./metrics";
import { getStats } from "./perf";

// The table is polled every this many samples, that is every 5 s (PRD §6.1).
export const STREAMS_EVERY_SAMPLES = 5;

// A video track the page receives, numbered by the wrapper.
interface StreamTrack {
  track: MediaStreamTrack;
  peer: RTCPeerConnection;
  n: number;
}

// The <video> that shows a track: the resolution is graded against its size (PRD §7).
interface ElementSize {
  clientWidth: number;
  clientHeight: number;
}

// A row's values: frame size, bitrate (kbps), loss (%) and the share of freezes (%).
export type StreamValues = Pick<StreamRow, "w" | "h" | "bitrate" | "loss" | "freezes">;

// The selected stream's values before its first sample.
const EMPTY: StreamValues = {
  w: null, h: null, bitrate: null, loss: null, freezes: null,
};

// A finite number from a report field, else null.
const num = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

// The other report is of the same SSRC: their counters can be compared.
const sameStream = (cur: RtpStats, other?: RtpStats): other is RtpStats => other !== undefined && other.ssrc === cur.ssrc;

// packetsLost Δ / (packetsLost Δ + packetsReceived Δ) × 100 since the previous poll; null without packets.
export const intervalLoss = (cur: RtpStats, prev?: RtpStats): number | null => {
  if (!sameStream(cur, prev)) {
    return null;
  }
  const received = delta(cur, prev, "packetsReceived");
  const lostCur = num(cur.packetsLost);
  const lostPrev = num(prev.packetsLost);
  if (received === null || lostCur === null || lostPrev === null) {
    return null;
  }
  const lost = lostCur - lostPrev;
  return lost + received > 0 ? Math.max(0, (lost / (lost + received)) * 100) : null;
};

// totalFreezesDuration Δ / the time the stream was watched × 100 (PRD §13.4), from its first poll on.
export const watchedFreezes = (cur: RtpStats, first?: RtpStats): number | null => {
  if (!sameStream(cur, first)) {
    return null;
  }
  const frozenS = delta(cur, first, "totalFreezesDuration");
  const watchedMs = delta(cur, first, "timestamp");
  return frozenS === null || !watchedMs ? null : Math.min(100, ((frozenS * 1000) / watchedMs) * 100);
};

// A stream's values at a poll: the frame size now, bitrate and loss since the previous poll, freezes since the first.
export const streamValues = (cur: RtpStats, prev?: RtpStats, first?: RtpStats): StreamValues => ({
  w: num(cur.frameWidth),
  h: num(cur.frameHeight),
  bitrate: bitrateKbps(cur, prev),
  loss: intervalLoss(cur, prev),
  freezes: watchedFreezes(cur, first),
});

// Grades from the best to the worst.
const RANK: Goodness[] = ["good", "moderate", "bad"];

// The worst of the grades; undefined without any.
export const worstGoodness = (grades: (Goodness | undefined)[]): Goodness | undefined => grades
  .reduce<Goodness | undefined>((worst, g) => (g && (!worst || RANK.indexOf(g) > RANK.indexOf(worst)) ? g : worst), undefined);

// The grade of a row's dot: its worst value by the thresholds of §7; the resolution only when a <video> shows it.
export const valuesGoodness = (v: StreamValues, element: ElementSize | null): Goodness | undefined => worstGoodness([
  v.w !== null && v.h !== null && element ? resolutionGoodness(v.w, v.h, element) : undefined,
  v.bitrate === null ? undefined : bitrateGoodness(v.bitrate, v.h),
  v.loss === null ? undefined : lossGoodness(v.loss),
  v.freezes === null ? undefined : freezesGoodness(v.freezes),
]);

// The selected stream's row: the values of its tiles (their grades come from selectedGoodness).
export const selectedValues = (sample: SampleValues): StreamValues => ({
  w: sample.v_w,
  h: sample.v_h,
  bitrate: sample.v_bitrate,
  loss: sample.v_loss,
  freezes: sample.v_freeze_pct,
});

// The selected stream's dot: the worst grade of the tiles its row shows.
export const selectedGoodness = (goodness: GoodnessMap): Goodness | undefined =>
  worstGoodness([goodness.resolution, goodness.bitrate, goodness.loss, goodness.freezes]);

// What a row is made of; `n` — the track's number from the wrapper.
interface RowSource {
  n: number;
  trackId: string;
  mid: string | null;
  selected: boolean;
  values: StreamValues;
  goodness?: Goodness;
}

// `Stream {N}` with the tooltip `track {id} · mid {mid}`.
export const streamRow = ({
  n, trackId, mid, selected, values, goodness,
}: RowSource): StreamRow => ({
  id: trackId,
  name: `Stream ${n}`,
  selected,
  ...values,
  ...(goodness ? { goodness } : {}),
  tooltip: `track ${trackId} · mid ${mid ?? "—"}`,
});

// The video inbound-rtp reports of a getStats() result.
const inboundVideo = (report: RTCStatsReport): RtpStats[] => {
  const list: RtpStats[] = [];
  report.forEach((stat: RtpStats) => {
    if (stat.type === "inbound-rtp" && stat.kind === "video") {
      list.push(stat);
    }
  });
  return list;
};

// The mid of the transceiver that receives the track; null without one.
const midOf = (peer: RTCPeerConnection, track: MediaStreamTrack): string | null => {
  const transceiver = peer.getTransceivers().find((t) => t.receiver.track === track);
  return transceiver?.mid ?? null;
};

// The <video> of the page that shows a track.
export const elementOf = (track: MediaStreamTrack): ElementSize | null => {
  const video = Array.from(document.getElementsByTagName("video"))
    .find((v) => v.srcObject instanceof MediaStream && v.srcObject.getVideoTracks().includes(track));
  return video ? { clientWidth: video.clientWidth, clientHeight: video.clientHeight } : null;
};

// What OtherStreams polls: the selected connection and track, the page's video tracks and the <video> of each.
interface StreamsSource {
  // The selected connection and the selected stream's video track.
  peer: RTCPeerConnection;
  track?: MediaStreamTrack;
  // The video tracks the page receives, by number.
  tracks: () => StreamTrack[];
  element: (track: MediaStreamTrack) => ElementSize | null;
}

// The rows of the table as of the last poll: the selected stream and every other one that has received media
// (a track of a transceiver that never got a packet has no inbound-rtp); none when there are no others.
export class OtherStreams {
  rows: StreamRow[] = [];
  // The first and the previous inbound-rtp of each other stream.
  private seen = new Map<MediaStreamTrack, { first: RtpStats; prev: RtpStats }>();
  private readonly source: StreamsSource;

  constructor(source: StreamsSource) {
    this.source = source;
  }

  // `report` — the selected connection's latest getStats(); `sample` and `goodness` — the session's latest sample.
  async poll(report: RTCStatsReport, sample: SampleValues | null, goodness: GoodnessMap): Promise<StreamRow[]> {
    const { peer: selectedPeer, track: selectedTrack } = this.source;
    const tracks = this.source.tracks();
    const reports = new Map<RTCPeerConnection, RtpStats[]>([[selectedPeer, inboundVideo(report)]]);
    const others = [...new Set(tracks.map(({ peer }) => peer))].filter((peer) => peer !== selectedPeer);
    await Promise.all(others.map(async (peer) => {
      try {
        reports.set(peer, inboundVideo(await getStats(peer)));
      } catch {
        // A closed or failing connection: its streams are left out this time.
      }
    }));

    const rows: StreamRow[] = [];
    const seen = new Map<MediaStreamTrack, { first: RtpStats; prev: RtpStats }>();
    tracks.forEach(({ track, peer, n }) => {
      const mid = midOf(peer, track);
      if (track === selectedTrack) {
        rows.push(streamRow({
          n, trackId: track.id, mid, selected: true, values: sample ? selectedValues(sample) : EMPTY, goodness: selectedGoodness(goodness),
        }));
        return;
      }
      const cur = findInbound(reports.get(peer) ?? [], "video", track.id, mid);
      if (!cur) {
        return;
      }
      const known = this.seen.get(track);
      const values = streamValues(cur, known?.prev, known?.first);
      seen.set(track, { first: known && sameStream(cur, known.first) ? known.first : cur, prev: cur });
      rows.push(streamRow({
        n, trackId: track.id, mid: mid ?? (typeof cur.mid === "string" ? cur.mid : null), selected: false, values, goodness: valuesGoodness(values, this.source.element(track)),
      }));
    });
    this.seen = seen;
    this.rows = rows.some((row) => !row.selected) ? rows : [];
    return this.rows;
  }
}
