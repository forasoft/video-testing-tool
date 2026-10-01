import { VTTInternal } from "types/vtt-internal";

import wrapRTCPeerConnection from "./wrap-web-rtc";

const initWrappers = (vttInternal: VTTInternal) => {
  wrapRTCPeerConnection(vttInternal);
};

export default initWrappers;
