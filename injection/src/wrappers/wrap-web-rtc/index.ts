import { CustomPeerConnection } from "src/types";
import { VTTInternal } from "types/vtt-internal";
import copyProperties from "utils/copy-properties";
import { watchTiming } from "./timing";
import { numberTrack } from "./tracks";

const RealRTCPeerConnection = RTCPeerConnection;

interface RTCPeerConnectionWindow extends Window {
  RTCPeerConnection: typeof RTCPeerConnection;
  webkitRTCPeerConnection: typeof RTCPeerConnection;
}

const wrapRTCPeerConnection = (vttInternal: VTTInternal) => {
  function WrappedRTCPeerConnection(configuration?: RTCConfiguration): RTCPeerConnection {
    if (!(this instanceof WrappedRTCPeerConnection)) {
      // call without new if wrapper was called without too (to throw native error)
      return (RealRTCPeerConnection as unknown as (configuration?: RTCConfiguration) => RTCPeerConnection)(configuration);
    }

    const peer = new RealRTCPeerConnection(configuration);

    vttInternal.push(peer);
    watchTiming(peer);

    const originalClose = peer.close;
    peer.close = (...args) => {
      const closedIndex = vttInternal.findIndex((connection) => {
        return connection === peer;
      });
      vttInternal.splice(closedIndex, 1);

      originalClose.call(peer, ...args);
    };

    peer.addEventListener("track", (e) => {
      const target = e.target as CustomPeerConnection;
      if (!target.tracks) {
        target.tracks = [];
      }
      target.tracks.push(e.track);
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
