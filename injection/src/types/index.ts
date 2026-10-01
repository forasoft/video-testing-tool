// A connection with the tracks it received: the wrapper collects them at its `track` events, and there are none
// until the first one.
export type CustomPeerConnection = RTCPeerConnection & {
  tracks?: MediaStreamTrack[];
};
