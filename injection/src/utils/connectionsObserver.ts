// The wrapper's list of the page's connections, handed over once at start (index.ts) to the code that searches it.
import { VTTInternal } from "src/types/vtt-internal";

// The page's connections as the RTCPeerConnection wrapper keeps them; null until the page script starts.
export let vttInternal: VTTInternal | null = null;

// Shares the wrapper's list with the modules that look a connection up (findRTCConnectionByTracks).
export const connectionsObserver = (connections: VTTInternal) => {
  vttInternal = connections;
};
