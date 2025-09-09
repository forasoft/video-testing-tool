export interface Candidates {
  priority?: number;
  local?: (RTCIceCandidate & { id: string }) | { id: string };
  remote?: (RTCIceCandidate & { id: string }) | { id: string };
}

export interface StatisticsReportItem {
  timestamp: number;
  candidates: Candidates;
  iceConnectionState: string;
  iceGatheringState: string;
  stats: RTCStatsReport;
}

export type CustomPeerConnection = RTCPeerConnection & {
  tracks: MediaStreamTrack[];
};
