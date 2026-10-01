// Wrappers of the page's WebRTC API, installed when the injection starts: connections created earlier are not seen.
import { VTTInternal } from "types/vtt-internal";

import wrapRTCPeerConnection from "./wrap-web-rtc";

// Installs every wrapper; `vttInternal` gets each RTCPeerConnection the page creates from then on.
const initWrappers = (vttInternal: VTTInternal) => {
  wrapRTCPeerConnection(vttInternal);
};

export default initWrappers;
