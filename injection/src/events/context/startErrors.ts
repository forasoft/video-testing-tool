// Why a stream could not be picked (PRD §14.2): a red line under the steps of the start screen.
export const START_ERRORS = {
  noVideo: "No video under the cursor. Right-click directly on a participant's video.",
  noConnection: "No WebRTC connection found for this video. It may not be a WebRTC stream, or it was created before the page loaded.",
  noStats: "This site does not allow reading connection statistics.",
} as const;
