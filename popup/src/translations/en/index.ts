export const translation = {
  stats: {
    averageFps: {
      label: "Frame rate",
      hintText: "Number of frames displayed per second",
      errorText: "This website doesn't allow testing fps",
    },
    videoDelay: {
      label: "Video delay",
      hintText: "Time to receive video stream",
      errorText: "This website doesn't allow testing video",
    },
    audioDelay: {
      label: "Audio delay",
      hintText: "Time to receive audio stream",
      errorText: "This website doesn't allow testing audio",
    },
    packetLoss: {
      label: "Packet loss",
      hintText:
        "Percentage of video and audio data failed to reach destination",
      errorText: "This website doesn't allow testing packet loss",
    },
    resolution: {
      label: "Resolution",
      hintText: "Number of pixels in each dimension",
      errorText: "This website doesn't allow testing resolution",
    },
    freezesDuration: {
      label: "Freezes & Stalls",
      hintText: "Percentage of freezes and stalls from total testing time",
      errorText: "This website doesn't allow testing freezes",
    },
    bitrate: {
      label: "Bitrate",
      hintText: "Number of kilobits received per second",
      errorText: "This website doesn't allow testing bitrate",
    },
    videoCodec: {
      label: "Video codec",
      errorText: "This website doesn't allow testing video codec",
    },
    audioCodec: {
      label: "Audio codec",
      errorText: "This website doesn't allow testing audio codec",
    },
    // Frame rate and Freezes & Stalls while no frames are rendered (PRD §14.4).
    suspended: {
      hidden: "Tab hidden — the browser does not render frames",
      paused: "Video paused — no frames to render",
    },
  },
};
