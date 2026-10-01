export type CustomPeerConnection = RTCPeerConnection & {
  tracks: MediaStreamTrack[];
};
