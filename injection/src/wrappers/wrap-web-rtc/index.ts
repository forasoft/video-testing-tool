import { VTTInternal } from "types/vtt-internal";
import copyProperties from "utils/copy-properties";

const RealRTCPeerConnection = RTCPeerConnection;

const wrappRTCPeerConnection = (vttInternal: VTTInternal) => {
  function WrappedRTCPeerConnection(configuration?: RTCConfiguration): RTCPeerConnection {
    if (!(this instanceof WrappedRTCPeerConnection)) {
      // call without new if wrapper was called without too (to throw native error)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (<any>RealRTCPeerConnection)(configuration);
    }

    const peer = new RealRTCPeerConnection(configuration);

    vttInternal.push(peer);

    const originalClose = peer.close;
    peer.close = (...args) => {
      const closedIndex = vttInternal.findIndex((connection) => {
        return connection === peer;
      })
      vttInternal.splice(closedIndex, 1);

      originalClose.call(peer, ...args);
    }

    peer.addEventListener("track", (e) => {
      const target = e.target as any;
      if (!target.tracks) {
        target.tracks = [];
      }
      target.tracks.push(e.track);

    });

    return peer;
  }

  copyProperties(RealRTCPeerConnection, WrappedRTCPeerConnection, ["generateCertificate", "name", "prototype"]);

  RealRTCPeerConnection.prototype.constructor = WrappedRTCPeerConnection;

  if ("RTCPeerConnection" in window) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (<any>window).RTCPeerConnection = WrappedRTCPeerConnection;
  }
  if ("webkitRTCPeerConnection" in window) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (<any>window).webkitRTCPeerConnection = WrappedRTCPeerConnection;
  }
};

export default wrappRTCPeerConnection;
