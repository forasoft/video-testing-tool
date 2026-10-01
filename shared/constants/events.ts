export const EVENTS = {
  VTT_CONTEXT_BTN_CLICK: "VTT_CONTEXT_BTN_CLICK",
  VTT_HIDE: "VTT_HIDE",
  VTT_WAS_HIDDEN: "VTT_WAS_HIDDEN",
  VTT_GO_TO_MAIN_SCREEN: "VTT_GO_TO_MAIN_SCREEN",
  VTT_IS_MAIN_SCREEN: "VTT_IS_MAIN_SCREEN",
  // popup → main.js: height of the panel's content, px.
  VTT_CONTENT_HEIGHT: "VTT_CONTENT_HEIGHT",
  // popup → main.js: the Expanded header was pressed, { clientX, clientY } in the iframe.
  VTT_DRAG_START: "VTT_DRAG_START",
  VTT_STOP_CALCULATION: "VTT_STOP_CALCULATION",
  VTT_DOWNLOAD_BUTTON_CLICK: "VTT_DOWNLOAD_BUTTON_CLICK",
  CONTEXT_MENU_VTT_WAS_CLICKED: "CONTEXT_MENU_VTT_WAS_CLICKED",
  // The previous run on this site (PRD §13.1), DOM events on window between the page and main.js with a JSON
  // string as the detail: the page saves a summary (VTT_STORE_LAST_RUN), main.js answers a session's start with
  // the stored one (VTT_LAST_RUN).
  VTT_STORE_LAST_RUN: "VTT_STORE_LAST_RUN",
  VTT_LAST_RUN: "VTT_LAST_RUN",
} as const;
