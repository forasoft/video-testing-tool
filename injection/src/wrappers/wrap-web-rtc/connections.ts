// The wrapper's list of the page's connections: how a closed one leaves it.
import { VTTInternal } from "types/vtt-internal";

// Takes a closed connection out of the page's list. Pages often close a connection twice (in a hang-up handler and
// again in a cleanup); the second close finds nothing and must not take another connection out — `splice(-1, 1)`
// would remove the last one, and StreamTest would no longer find it.
export const forgetConnection = (connections: VTTInternal, peer: RTCPeerConnection): void => {
  const index = connections.indexOf(peer);
  if (index >= 0) {
    connections.splice(index, 1);
  }
};
