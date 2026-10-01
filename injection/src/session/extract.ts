// RTCStatsReport → Snapshot: only the reports of the selected stream that the metrics need.

export interface RtpStats {
  id: string;
  timestamp: number;
  type: string;
  kind?: string;
  ssrc?: number;
  mid?: string;
  trackIdentifier?: string;
  codecId?: string;
  [key: string]: unknown;
}

// Properties of the selected <video>, read together with getStats().
export interface ElementInfo {
  videoWidth: number;
  videoHeight: number;
  clientWidth: number;
  clientHeight: number;
  droppedFrames: number | null;
  readyState: number;
}

// Rendered frames (frames.ts): the last second and the freezes of the whole session.
export interface FramesInfo {
  // null until the session has run for a whole window of 1 s.
  fps: number | null;
  // Mean rVFC presentationTime − receiveTime; null without frames or without receiveTime.
  latency: number | null;
  freezeMs: number;
  sessionMs: number;
  // Share of the time since the previous sample that the tab was hidden or the video paused, 0…1.
  hidden: number;
}

export interface Snapshot {
  element?: ElementInfo;
  frames?: FramesInfo;
  // Long tasks reported since the previous sample, ms (longtasks.ts); null — not reported by the browser.
  longTasks?: { max: number; sum: number } | null;
  video?: RtpStats;
  audio?: RtpStats;
  videoCodec?: RtpStats;
  audioCodec?: RtpStats;
  transport?: RtpStats;
  pair?: RtpStats;
  local?: RtpStats;
  remote?: RtpStats;
  // outbound-rtp of the video this connection sends (one per simulcast layer).
  outbound?: RtpStats[];
  // media-source of that video: the size it is captured at.
  outboundSource?: RtpStats;
}

// How to find the selected stream's reports: by track id, or by kind + mid when
// the browser does not report trackIdentifier.
export interface StreamSelector {
  videoTrackId?: string;
  audioTrackId?: string;
  videoMid?: string | null;
  audioMid?: string | null;
}

export const createSelector = (
  peerConnection: RTCPeerConnection,
  tracks: MediaStreamTrack[]
): StreamSelector => {
  const selector: StreamSelector = {};
  const transceivers = peerConnection.getTransceivers
    ? peerConnection.getTransceivers()
    : [];

  tracks.forEach((track) => {
    const transceiver = transceivers.find((t) => t.receiver.track === track);
    const mid = transceiver ? transceiver.mid : null;

    if (track.kind === "video" && !selector.videoTrackId) {
      selector.videoTrackId = track.id;
      selector.videoMid = mid;
    }
    if (track.kind === "audio" && !selector.audioTrackId) {
      selector.audioTrackId = track.id;
      selector.audioMid = mid;
    }
  });

  return selector;
};

export const findInbound = (
  inbound: RtpStats[],
  kind: string,
  trackId: string | undefined,
  mid: string | null | undefined
): RtpStats | undefined => {
  if (!trackId) {
    return undefined;
  }

  return (
    inbound.find((s) => s.kind === kind && s.trackIdentifier === trackId) ??
    inbound.find((s) => s.kind === kind && mid != null && s.mid === mid)
  );
};

export const readElement = (video: HTMLVideoElement): ElementInfo => ({
  videoWidth: video.videoWidth,
  videoHeight: video.videoHeight,
  clientWidth: video.clientWidth,
  clientHeight: video.clientHeight,
  droppedFrames: video.getVideoPlaybackQuality
    ? video.getVideoPlaybackQuality().droppedVideoFrames
    : null,
  readyState: video.readyState,
});

export const extract = (
  report: RTCStatsReport,
  selector: StreamSelector
): Snapshot => {
  const byId = new Map<string, RtpStats>();
  const inbound: RtpStats[] = [];
  const outbound: RtpStats[] = [];
  const pairs: RtpStats[] = [];
  let transport: RtpStats | undefined;

  report.forEach((stat: RtpStats) => {
    byId.set(stat.id, stat);
    if (stat.type === "inbound-rtp") {
      inbound.push(stat);
    }
    if (stat.type === "outbound-rtp" && stat.kind === "video") {
      outbound.push(stat);
    }
    if (stat.type === "candidate-pair") {
      pairs.push(stat);
    }
    if (stat.type === "transport" && !transport) {
      transport = stat;
    }
  });

  const get = (id: unknown): RtpStats | undefined =>
    typeof id === "string" ? byId.get(id) : undefined;

  const video = findInbound(inbound, "video", selector.videoTrackId, selector.videoMid);
  const audio = findInbound(inbound, "audio", selector.audioTrackId, selector.audioMid);

  // The video's own transport, if the page runs several (no BUNDLE).
  const videoTransport = video && get(video.transportId);
  const selectedTransport = videoTransport ?? transport;

  let pair = selectedTransport && get(selectedTransport.selectedCandidatePairId);
  if (!pair) {
    pair = pairs.find((p) => p.nominated && p.state === "succeeded");
  }

  return {
    video,
    audio,
    videoCodec: video && get(video.codecId),
    audioCodec: audio && get(audio.codecId),
    transport: selectedTransport,
    pair,
    local: pair && get(pair.localCandidateId),
    remote: pair && get(pair.remoteCandidateId),
    outbound,
    outboundSource: outbound.map((layer) => get(layer.mediaSourceId)).find((source) => source !== undefined),
  };
};
