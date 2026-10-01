// Ids of the messages and DOM events between background.js, main.js, the page (injection) and the panel (popup).
export const EVENTS = {
  // background.js → page: the context menu item Test stream was clicked; it also stops the running session.
  VTT_CONTEXT_BTN_CLICK: "VTT_CONTEXT_BTN_CLICK",
  // main.js or popup → page: Close; main.js hides the panel, the injection stops the session.
  VTT_HIDE: "VTT_HIDE",
  // main.js → popup: the panel was hidden; it shows the start screen.
  VTT_WAS_HIDDEN: "VTT_WAS_HIDDEN",
  // injection → popup: the start screen with { error }; the same name as a DOM event on window makes main.js open
  // the panel.
  VTT_GO_TO_MAIN_SCREEN: "VTT_GO_TO_MAIN_SCREEN",
  // popup → main.js: `value` — whether the start screen is shown; main.js hides the session's buttons then.
  VTT_IS_MAIN_SCREEN: "VTT_IS_MAIN_SCREEN",
  // popup → main.js: height of the panel's content, px.
  VTT_CONTENT_HEIGHT: "VTT_CONTENT_HEIGHT",
  // popup → main.js: the Expanded header was pressed, { clientX, clientY } in the iframe.
  VTT_DRAG_START: "VTT_DRAG_START",
  // popup → injection: Back to main stops the session.
  VTT_STOP_CALCULATION: "VTT_STOP_CALCULATION",
  // main.js → injection, a DOM event on window: Download logs in the Compact / Mini header — the JSON export.
  VTT_DOWNLOAD_BUTTON_CLICK: "VTT_DOWNLOAD_BUTTON_CLICK",
  // injection → popup, and as a DOM event on window → main.js: a stream was picked and its session starts.
  CONTEXT_MENU_VTT_WAS_CLICKED: "CONTEXT_MENU_VTT_WAS_CLICKED",
  // The previous run on this site (PRD §13.1), DOM events on window between the page and main.js with a JSON
  // string as the detail: the page saves a summary (VTT_STORE_LAST_RUN), main.js answers a session's start with
  // the stored one (VTT_LAST_RUN).
  VTT_STORE_LAST_RUN: "VTT_STORE_LAST_RUN",
  VTT_LAST_RUN: "VTT_LAST_RUN",
} as const;
