import { VTTInternal } from "types/vtt-internal";

import wrappRTCPeerConnection from "./wrap-web-rtc";

const initWrappers = (vttInternal: VTTInternal) => {
  wrappRTCPeerConnection(vttInternal);
};

export default initWrappers;
