// Wraps the page's RTCPeerConnection (and webkitRTCPeerConnection) so that StreamTest sees every new connection.
import { CustomPeerConnection } from "src/types";
import { VTTInternal } from "types/vtt-internal";
import copyProperties from "utils/copy-properties";
import { forgetConnection } from "./connections";
import { watchTiming } from "./timing";
import { numberTrack } from "./tracks";

// The native constructor, taken before the wrapper replaces it on window.
const RealRTCPeerConnection = RTCPeerConnection;

interface RTCPeerConnectionWindow extends Window {
  RTCPeerConnection: typeof RTCPeerConnection;
  webkitRTCPeerConnection: typeof RTCPeerConnection;
}

// Replaces the page's RTCPeerConnection with a wrapper that keeps every connection in `vttInternal` (StreamTest finds
// the connection of a picked video there), times its signalling and numbers its incoming video tracks.
const wrapRTCPeerConnection = (vttInternal: VTTInternal) => {
  function WrappedRTCPeerConnection(this: unknown, configuration?: RTCConfiguration): RTCPeerConnection {
    if (!(this instanceof WrappedRTCPeerConnection)) {
      // Called without `new`: call the native constructor the same way, so that it throws its own error.
      return (RealRTCPeerConnection as unknown as (configuration?: RTCConfiguration) => RTCPeerConnection)(configuration);
    }

    const peer = new RealRTCPeerConnection(configuration);

    vttInternal.push(peer);
    watchTiming(peer);

    const originalClose = peer.close.bind(peer);
    peer.close = () => {
      forgetConnection(vttInternal, peer);
      originalClose();
    };

    peer.addEventListener("track", (e) => {
      const target = e.target as CustomPeerConnection;
      (target.tracks ??= []).push(e.track);
      numberTrack(peer, e.track);
    });

    return peer;
  }

  copyProperties(RealRTCPeerConnection, WrappedRTCPeerConnection, ["generateCertificate", "name", "prototype"]);

  RealRTCPeerConnection.prototype.constructor = WrappedRTCPeerConnection;

  const targetWindow = window as unknown as RTCPeerConnectionWindow;

  if ("RTCPeerConnection" in window) {
    targetWindow.RTCPeerConnection = WrappedRTCPeerConnection as unknown as typeof RTCPeerConnection;
  }
  if ("webkitRTCPeerConnection" in window) {
    targetWindow.webkitRTCPeerConnection = WrappedRTCPeerConnection as unknown as typeof RTCPeerConnection;
  }
};

export default wrapRTCPeerConnection;
