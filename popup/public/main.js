// Content script of the pages StreamTest runs on: adds injection.js to the page and draws the panel around its
// iframe — the Compact / Mini header, modes and sizes, dragging — and is the page's bridge to chrome.storage.

// Ids of the messages and DOM events shared with the page, the panel and background.js: this file is copied to
// build/ as is (popup/public), so it keeps its own copy instead of importing shared/.
const CONST = {
  VTT_HIDE: "VTT_HIDE",
  VTT_WAS_HIDDEN: "VTT_WAS_HIDDEN",
  VTT_EXTENSION_BUTTON_CLICK: "VTT_EXTENSION_BUTTON_CLICK",
  VTT_DOWNLOAD_BUTTON_CLICK: "VTT_DOWNLOAD_BUTTON_CLICK",
  VTT_IS_MAIN_SCREEN: "VTT_IS_MAIN_SCREEN",
  VTT_GO_TO_MAIN_SCREEN: "VTT_GO_TO_MAIN_SCREEN",
  VTT_SET_MODE: "VTT_SET_MODE",
  VTT_DRAG_START: "VTT_DRAG_START",
  VTT_CONTENT_HEIGHT: "VTT_CONTENT_HEIGHT",
  CONTEXT_MENU_VTT_WAS_CLICKED: "CONTEXT_MENU_VTT_WAS_CLICKED",
  VTT_STORE_LAST_RUN: "VTT_STORE_LAST_RUN",
  VTT_LAST_RUN: "VTT_LAST_RUN",
};

// Panel modes, PRD §8.1: Mini and Compact are as tall as their content, Expanded is
// 900 × 700 and shrinks to a small window.
const MODES = ["mini", "compact", "expanded"];
const MODE_WIDTH = { mini: 190, compact: 350 };
const EXPANDED_WIDTH = 900;
const EXPANDED_HEIGHT = 700;
const EXPANDED_MIN_WINDOW_WIDTH = 940;
const EXPANDED_MIN_WINDOW_HEIGHT = 720;
const WINDOW_MARGIN = 20;
// In Expanded the iframe draws the header: 16 px padding + 44 px header is the drag handle.
const EXPANDED_HANDLE_HEIGHT = 60;
// Width animation of the panel (main.css).
const TRANSITION_MS = 300;
// The last mode, applied when the next session starts.
const MODE_KEY = "ui.mode";
// The previous run on this site (PRD §13.1): one summary per origin, at most 4 KB.
const LAST_RUN_KEY = `lastRun:${location.origin}`;
const LAST_RUN_MAX_LENGTH = 4096;

// The mode the panel is sized for now; the start screen forces Compact, MODE_KEY keeps the tester's choice.
let mode = "compact";

// injection.js goes into the page as a <script>: it has to run in the page's own JS world to wrap the page's
// RTCPeerConnection, and a content script's world is isolated.
function inject({ url, id }) {
  const injectJS = document.createElement("script");
  injectJS.setAttribute("charset", "utf-8");
  injectJS.type = "text/javascript";
  injectJS.src = chrome.runtime.getURL(url);
  injectJS.id = id;
  document.head.insertBefore(injectJS, document.head.childNodes[0]);
}
inject({ url: "injection.js", id: "video-testing-tool" });

// A layer over the whole window that lets the pointer through to the page (main.css); it takes it only while the
// panel is dragged.
const frameContainer = document.createElement("div");
frameContainer.id = "vttFrameContainer";
frameContainer.classList.add("VTT_frameContainer");
frameContainer.classList.add("VTT_displayNone");

// The panel: placed by `top` and `right`, which dragging and fitting it to the window change.
const frameWrapper = document.createElement("div");
frameWrapper.style.top = "10px";
frameWrapper.style.right = "10px";
frameWrapper.classList.add("VTT_frameWrapper");

// The header of Compact and Mini, outside the iframe: pressing it drags the panel. Expanded hides it and draws its
// own in the iframe.
const header = document.createElement("header");
header.classList.add("VTT_header");
header.addEventListener("pointerdown", handleDragFrame);

const title = document.createElement("div");
title.innerText = "StreamTest";
title.classList.add("VTT_headerTitle");

const timeline = document.createElement("button");
timeline.setAttribute("aria-label", "Open timeline");
timeline.innerHTML = `
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
    <rect width="34" height="34" rx="17" fill="#1D1D1B" fill-opacity="0.06" />
    <path d="M10.5 21.5L14.5 16.5L18 19.5L23.5 12.5" stroke="#A3A5A7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
timeline.addEventListener("click", handleClickTimelineButton);
timeline.classList.add("VTT_headerButton");

// Tooltips of the header buttons (PRD §8.2, §17): after 500 ms of hover or keyboard focus; the buttons say the same
// with aria-label.
function buttonTooltip(text, ...classes) {
  const tooltip = document.createElement("div");
  tooltip.innerText = text;
  tooltip.setAttribute("aria-hidden", "true");
  tooltip.classList.add("VTT_buttonTooltip", ...classes);
  return tooltip;
}

// Open timeline is the first button: in Mini its tooltip opens to the right, inside the panel.
const timelineTooltip = buttonTooltip("Open timeline", "VTT_buttonTooltipStart");

const download = document.createElement("button");
download.setAttribute("aria-label", "Download logs");
download.innerHTML = `
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
    <rect width="34" height="34" rx="17" fill="#1D1D1B" fill-opacity="0.06" />
    <path d="M17.3125 23.5V12.5M17.3125 23.5L13.3125 19.8333M17.3125 23.5L21.3125 19.8333" stroke="#A3A5A7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
download.addEventListener("click", handleClickDownloadButton);
download.classList.add("VTT_headerButton");

const downloadTooltip = buttonTooltip("Download logs");

// Resize icons: to Mini (shown in Compact) and back to Compact (shown in Mini).
const RESIZE_TO_MINI_ICON = `
    <rect x="0.987061" y="0.855469" width="34" height="34" rx="17" fill="#1D1D1B" fill-opacity="0.06"/>
    <path fill-rule="evenodd" clip-rule="evenodd" d="M11.9871 14.2305C11.9871 12.9188 13.0504 11.8555 14.3621 11.8555C14.9144 11.8555 15.3621 11.4078 15.3621 10.8555C15.3621 10.3032 14.9144 9.85547 14.3621 9.85547C11.9458 9.85547 9.98707 11.8142 9.98707 14.2305V18.4555L9.98707 18.4983C9.98706 19.5821 9.98705 20.4562 10.0449 21.1641C10.1044 21.8929 10.2302 22.5331 10.532 23.1254C11.0114 24.0662 11.7763 24.8311 12.7171 25.3105C13.3094 25.6123 13.9496 25.7381 14.6784 25.7977C15.3863 25.8555 16.2605 25.8555 17.3443 25.8555H17.3871H21.6121C24.0283 25.8555 25.9871 23.8967 25.9871 21.4805C25.9871 20.9282 25.5394 20.4805 24.9871 20.4805C24.4348 20.4805 23.9871 20.9282 23.9871 21.4805C23.9871 22.7922 22.9237 23.8555 21.6121 23.8555H17.3871C16.2505 23.8555 15.4581 23.8547 14.8413 23.8043C14.2361 23.7549 13.8884 23.6627 13.6251 23.5285C13.0606 23.2409 12.6017 22.7819 12.314 22.2174C12.1799 21.9541 12.0877 21.6064 12.0382 21.0012C11.9878 20.3844 11.9871 19.5921 11.9871 18.4555V14.2305ZM25.3669 11.5746C25.7574 11.1841 25.7574 10.5509 25.3669 10.1604C24.9764 9.76984 24.3432 9.76984 23.9527 10.1604L20.8006 13.3124L20.8006 10.8674C20.8006 10.3151 20.3529 9.86743 19.8006 9.86743C19.2484 9.86743 18.8006 10.3151 18.8006 10.8674L18.8006 15.7266C18.8006 16.2788 19.2484 16.7266 19.8006 16.7266L25.0685 16.7266C25.6208 16.7266 26.0685 16.2788 26.0685 15.7266C26.0685 15.1743 25.6208 14.7266 25.0685 14.7266L22.2149 14.7266L25.3669 11.5746Z" fill="#A3A5A7"/>
`;
const RESIZE_TO_COMPACT_ICON = `
    <rect width="34" height="34" rx="17" fill="#1D1D1B" fill-opacity="0.06"/>
    <path fill-rule="evenodd" clip-rule="evenodd" d="M11 13.375C11 12.0633 12.0633 11 13.375 11C13.9273 11 14.375 10.5523 14.375 10C14.375 9.44772 13.9273 9.00001 13.375 9.00001C10.9588 9.00001 9.00001 10.9588 9.00001 13.375V17.6L9.00001 17.6428C8.99999 18.7266 8.99999 19.6007 9.05782 20.3086C9.11737 21.0375 9.24319 21.6777 9.54497 22.27C10.0243 23.2108 10.7892 23.9757 11.7301 24.455C12.3223 24.7568 12.9625 24.8826 13.6914 24.9422C14.3993 25 15.2734 25 16.3572 25H16.4H20.625C23.0413 25 25 23.0413 25 20.625C25 20.0727 24.5523 19.625 24 19.625C23.4477 19.625 23 20.0727 23 20.625C23 21.9367 21.9367 23 20.625 23H16.4C15.2634 23 14.4711 22.9992 13.8542 22.9488C13.2491 22.8994 12.9014 22.8072 12.638 22.673C12.0735 22.3854 11.6146 21.9265 11.327 21.362C11.1928 21.0986 11.1006 20.7509 11.0512 20.1458C11.0008 19.5289 11 18.7366 11 17.6V13.375ZM18.1094 14.4791C17.7189 14.8697 17.7189 15.5028 18.1094 15.8933C18.5 16.2839 19.1331 16.2839 19.5237 15.8933L22.9881 12.4289L22.9881 15.1863C22.9881 15.7386 23.4358 16.1863 23.9881 16.1863C24.5404 16.1863 24.9881 15.7386 24.9881 15.1863L24.9881 10.0147C24.9881 9.46243 24.5404 9.01471 23.9881 9.01471L18.3815 9.01471C17.8292 9.01471 17.3815 9.46243 17.3815 10.0147C17.3815 10.567 17.8292 11.0147 18.3815 11.0147L21.5739 11.0147L18.1094 14.4791Z" fill="#A3A5A7"/>
`;

const resize = document.createElement("button");
resize.setAttribute("aria-label", "Resize");
resize.innerHTML = `<svg width="34" height="34" viewBox="0 0 34 34" fill="none">${RESIZE_TO_MINI_ICON}</svg>`;
resize.addEventListener("click", handleClickResizeButton);
resize.classList.add("VTT_headerButton", "VTT_resizeIcon");

const resizeTooltip = buttonTooltip("Resize");

const cross = document.createElement("button");
cross.setAttribute("aria-label", "Close");
cross.innerHTML = `
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
    <rect width="34" height="34" rx="17" fill="#1D1D1B" fill-opacity="0.06" />
    <path d="M12.75 12.75L21.9583 21.9583" stroke="#A3A5A7" stroke-width="2" stroke-linecap="round" />
    <path d="M21.9583 12.75L12.7499 21.9583" stroke="#A3A5A7" stroke-width="2" stroke-linecap="round" />
  </svg>
`;
cross.addEventListener("click", handleClickCloseButton);
cross.classList.add("VTT_headerButton");

// Close is the last button: its tooltip opens to the left, inside the panel.
const crossTooltip = buttonTooltip("Close", "VTT_buttonTooltipEnd");

// The extension's origin, where the panel is loaded from: chrome-extension://<id> (getURL("") ends with a "/").
const EXTENSION_ORIGIN = chrome.runtime.getURL("").slice(0, -1);

const frame = document.createElement("iframe");
// The panel takes messages from this page alone: the page's origin is in the panel's address.
frame.src = chrome.runtime.getURL("/index.html") + "?page=" + encodeURIComponent(window.origin);
frame.id = "vttFrame";
frame.name = "vttFrame";
// Copy summary writes to the clipboard from the panel, which is another origin than the page (PRD §16 F9).
frame.allow = "clipboard-write";
frame.classList.add("VTT_characteristicContainer");

// Buttons of a running session; the start screen shows only Close (PRD §8.2).
const sessionButtons = [timeline, download, resize];

header.appendChild(title);
timeline.appendChild(timelineTooltip);
header.appendChild(timeline);
download.appendChild(downloadTooltip);
header.appendChild(download);
resize.appendChild(resizeTooltip);
header.appendChild(resize);
cross.appendChild(crossTooltip);
header.appendChild(cross);
frameWrapper.appendChild(header);
frameWrapper.appendChild(frame);
frameContainer.appendChild(frameWrapper);
document.body.appendChild(frameContainer);

// Pressing the header drags the panel, unless the press is on one of its buttons.
function handleDragFrame(e) {
  const path = e.composedPath();
  if (
    path.includes(cross) ||
    path.includes(download) ||
    path.includes(resize) ||
    path.includes(timeline)
  ) {
    return;
  }
  e.preventDefault();
  startDrag(e.clientX, e.clientY);
}

// Where the panel may be: at least 30 % of its width on the screen and its drag handle below the top edge.
function dragBounds() {
  const handleHeight = mode === "expanded" ? EXPANDED_HANDLE_HEIGHT : header.offsetHeight;
  return {
    maxRight: frameContainer.offsetWidth - frameWrapper.offsetWidth * 0.3,
    minRight: -frameWrapper.offsetWidth * 0.7,
    maxTop: frameContainer.offsetHeight - handleHeight,
  };
}

// Drags the panel after a pointer pressed at (clientX, clientY) of the page until it is released. Meanwhile the
// full-window layer takes the pointer: over the iframe the page would get no pointermove.
function startDrag(clientX, clientY) {
  frameWrapper.style.pointerEvents = "none";
  frameContainer.style.pointerEvents = "auto";
  frameContainer.style.cursor = "move";
  const frameShiftX = parseInt(frameWrapper.style.right);
  const frameShiftY = parseInt(frameWrapper.style.top);
  const { maxRight, minRight, maxTop } = dragBounds();

  // The panel follows the pointer, within the bounds taken when the drag began.
  function moveFrameHandler(e) {
    let newRight = clientX - e.clientX + frameShiftX;
    let newTop = e.clientY - clientY + frameShiftY;

    if (newRight > maxRight) {
      newRight = maxRight;
    }
    if (newTop > maxTop) {
      newTop = maxTop;
    }
    if (newRight < minRight) {
      newRight = minRight;
    }
    if (newTop < 0) {
      newTop = 0;
    }
    frameWrapper.style.right = newRight + "px";
    frameWrapper.style.top = newTop + "px";
  }

  // The drop: the pointer goes back to the page and the panel.
  function removeMoveFrameHandler() {
    frameWrapper.style.pointerEvents = "auto";
    frameContainer.style.pointerEvents = "none";
    frameContainer.style.cursor = "inherit";
    document.removeEventListener("pointermove", moveFrameHandler);
    document.removeEventListener("pointerleave", removeMoveFrameHandler);
    document.removeEventListener("pointerup", removeMoveFrameHandler);
  }

  document.addEventListener("pointermove", moveFrameHandler);
  document.addEventListener("pointerleave", removeMoveFrameHandler);
  document.addEventListener("pointerup", removeMoveFrameHandler);
}

// Download logs: the injection exports the session as JSON. A DOM event, as the page and this script share window.
function handleClickDownloadButton() {
  const event = new Event(CONST.VTT_DOWNLOAD_BUTTON_CLICK);
  window.dispatchEvent(event);
}

// Open timeline: Expanded on its Timeline tab.
function handleClickTimelineButton() {
  setMode("expanded", "timeline");
}

// Resize switches between Compact and Mini.
function handleClickResizeButton() {
  setMode(mode === "mini" ? "compact" : "mini");
}

// Close (PRD §8.2): the same VTT_HIDE as Close in Expanded — hides the panel, and the
// injection stops the session. Posted to this page's own window, to its origin alone ("/").
function handleClickCloseButton() {
  window.postMessage({ id: CONST.VTT_HIDE }, "/");
}

// Expanded is 900 × 700; a window narrower than 940 px or lower than 720 px shrinks that side to the window less 20 px.
function expandedSize() {
  return {
    width: window.innerWidth < EXPANDED_MIN_WINDOW_WIDTH ? window.innerWidth - WINDOW_MARGIN : EXPANDED_WIDTH,
    height: window.innerHeight < EXPANDED_MIN_WINDOW_HEIGHT ? window.innerHeight - WINDOW_MARGIN : EXPANDED_HEIGHT,
  };
}

// Expanded opens where Compact was and is pushed back onto the screen if it does not fit.
function keepOnScreen(width, height) {
  const maxRight = Math.max(0, (frameContainer.clientWidth || window.innerWidth) - width);
  const maxTop = Math.max(0, (frameContainer.clientHeight || window.innerHeight) - height);
  const right = Math.min(Math.max(parseInt(frameWrapper.style.right), 0), maxRight);
  const top = Math.min(Math.max(parseInt(frameWrapper.style.top), 0), maxTop);
  frameWrapper.style.right = right + "px";
  frameWrapper.style.top = top + "px";
}

// The window was resized (PRD §8.1, §16 F17): Expanded takes the size of the new window (the tab scrolls, the
// charts narrow) and stays on the screen; Mini and Compact keep within the bounds of a drag.
function fitWindow() {
  if (frameContainer.classList.contains("VTT_displayNone")) {
    return;
  }
  if (mode === "expanded") {
    const { width, height } = expandedSize();
    frame.style.width = width + "px";
    frame.style.height = height + "px";
    keepOnScreen(width, height);
    return;
  }
  const { maxRight, minRight, maxTop } = dragBounds();
  frameWrapper.style.right = Math.max(minRight, Math.min(maxRight, parseInt(frameWrapper.style.right))) + "px";
  frameWrapper.style.top = Math.max(0, Math.min(maxTop, parseInt(frameWrapper.style.top))) + "px";
}

window.addEventListener("resize", fitWindow);

// Sizes the panel for a mode and tells the iframe which layout to draw: at once when the
// panel shrinks, after the width animation when it grows (the content is not squeezed).
function applyMode(next, tab) {
  const growing = next === "expanded" || (next === "compact" && mode === "mini");
  mode = next;

  header.classList.toggle("VTT_displayNone", next === "expanded");
  header.classList.toggle("VTT_headerSmallSize", next === "mini");
  resize.querySelector("svg").innerHTML = next === "mini" ? RESIZE_TO_COMPACT_ICON : RESIZE_TO_MINI_ICON;
  if (next === "mini") {
    title.classList.add("VTT_displayNone");
  } else {
    // Delay showing title until CSS transition finishes
    setTimeout(() => {
      if (mode !== "mini") {
        title.classList.remove("VTT_displayNone");
      }
    }, growing ? TRANSITION_MS : 0);
  }

  if (next === "expanded") {
    const { width, height } = expandedSize();
    frame.style.width = width + "px";
    frame.style.height = height + "px";
    keepOnScreen(width, height);
  } else {
    frame.style.width = MODE_WIDTH[next] + "px";
  }

  const tell = () => {
    frame.contentWindow.postMessage({ id: CONST.VTT_SET_MODE, data: { mode: next, tab } }, EXTENSION_ORIGIN);
  };
  if (growing) {
    setTimeout(tell, TRANSITION_MS);
  } else {
    tell();
  }
}

// A mode the tester picked: applied and kept for the next session (chrome.storage.local).
function setMode(next, tab) {
  if (!MODES.includes(next)) {
    return;
  }
  applyMode(next, tab);
  try {
    chrome.storage.local.set({ [MODE_KEY]: next });
  } catch {
    // The extension was reloaded: this page's content script can no longer store.
  }
}

// A session started: the panel takes the mode saved last (Expanded opens on Timeline), or Compact if there is none.
function applySavedMode() {
  const fallback = () => applyMode("compact", "timeline");
  try {
    chrome.storage.local.get(MODE_KEY, (items) => {
      const saved = items && items[MODE_KEY];
      if (MODES.includes(saved)) {
        applyMode(saved, "timeline");
      } else {
        fallback();
      }
    });
  } catch {
    fallback();
  }
}

// Shows the buttons of a session, or hides them on the start screen. Hidden buttons also lose VTT_headerButton:
// Close right after one would take its 10 px gap (main.css) instead of margin-left: auto and leave the right edge.
function setSessionButtons(visible) {
  sessionButtons.forEach((button) => {
    button.classList.toggle("VTT_headerButton", visible);
    button.classList.toggle("VTT_displayNone", !visible);
  });
}

// Shows a hidden panel, or hides a shown one unless `open`; the panel is told it was hidden (VTT_WAS_HIDDEN) and
// goes back to its start screen.
function toggleDisplayFrameContainer(e, open) {
  if (frameContainer.classList.contains("VTT_displayNone")) {
    frameContainer.classList.remove("VTT_displayNone");
  } else if (!open) {
    frameContainer.classList.add("VTT_displayNone");
    frame.contentWindow.postMessage({ id: CONST.VTT_WAS_HIDDEN }, EXTENSION_ORIGIN);
  }
}

// Hides the panel unless it is hidden already: Close of this header or of Expanded (VTT_HIDE).
function hideFrameContainer() {
  if (!frameContainer.classList.contains("VTT_displayNone")) {
    toggleDisplayFrameContainer();
  }
}

// Messages this page posts to its own window: Close in this header (VTT_HIDE) and the toolbar button (background.js).
const pageHandlers = new Map([
  [CONST.VTT_HIDE, hideFrameContainer],
  // The toolbar button shows or hides the panel, sized for the start screen.
  [CONST.VTT_EXTENSION_BUTTON_CLICK, () => {
    toggleDisplayFrameContainer();
    setSessionButtons(false);
    applyMode("compact");
  }],
]);

// Messages of the panel: Close in Expanded, its content height, a mode it asks for, a drag of its header, and whether
// it shows its start screen.
const frameHandlers = new Map([
  [CONST.VTT_HIDE, hideFrameContainer],
  [CONST.VTT_CONTENT_HEIGHT, (data) => {
    // Expanded has its own height; Mini and Compact are as tall as their content.
    const height = data && data.height;
    if (mode !== "expanded" && height > 0) {
      frame.style.height = height + "px";
    }
  }],
  [CONST.VTT_SET_MODE, (data) => {
    setMode(data && data.mode, data && data.tab);
  }],
  [CONST.VTT_DRAG_START, (data) => {
    const rect = frame.getBoundingClientRect();
    startDrag(rect.left + data.clientX, rect.top + data.clientY);
  }],
  [CONST.VTT_IS_MAIN_SCREEN, (data) => {
    if (data && data.value) {
      // The start screen is drawn at the Compact size; the tester's mode stays saved.
      setSessionButtons(false);
      applyMode("compact");
    } else {
      setSessionButtons(true);
    }
  }],
]);

// Messages are taken from the panel's iframe and from this page's own window alone, each from its own origin, so that
// other frames of the page cannot pose as them. Maps, not objects: an id such as "toString" finds nothing.
window.addEventListener("message", (e) => {
  const id = e.data?.id;
  if (e.source === frame.contentWindow && e.origin === EXTENSION_ORIGIN) {
    frameHandlers.get(id)?.(e.data.data);
  } else if (e.source === window && e.origin === window.origin) {
    pageHandlers.get(id)?.();
  }
});

// The page (injection) and this script share window, not chrome.storage: a session's start is answered with the
// stored summary, and the page hands over the summary of a run when it ends or the page is left. DOM events are
// synchronous, so the summary of beforeunload is stored before the page goes.
function loadLastRun() {
  const answer = (run) => {
    window.dispatchEvent(new CustomEvent(CONST.VTT_LAST_RUN, { detail: JSON.stringify(run ?? null) }));
  };
  try {
    chrome.storage.local.get(LAST_RUN_KEY, (items) => answer(items && items[LAST_RUN_KEY]));
  } catch {
    // The extension was reloaded: this page's content script can no longer read.
    answer(null);
  }
}

// The page's summary of a run: stored for this origin if it is JSON of at most LAST_RUN_MAX_LENGTH characters.
window.addEventListener(CONST.VTT_STORE_LAST_RUN, (e) => {
  const detail = typeof e.detail === "string" ? e.detail : "";
  if (!detail || detail.length > LAST_RUN_MAX_LENGTH) {
    return;
  }
  try {
    chrome.storage.local.set({ [LAST_RUN_KEY]: JSON.parse(detail) });
  } catch {
    // Not a summary, or the extension was reloaded.
  }
});

// A session started on a picked stream: the panel opens in the saved mode, and the page gets the stored last run.
window.addEventListener(CONST.CONTEXT_MENU_VTT_WAS_CLICKED, () => {
  toggleDisplayFrameContainer(null, true);
  applySavedMode();
  loadLastRun();
});

// A stream could not be picked (PRD §14.2): the start screen says why, so the panel opens if it was hidden.
window.addEventListener(CONST.VTT_GO_TO_MAIN_SCREEN, () => {
  toggleDisplayFrameContainer(null, true);
});

// The styles of the panel's frame, header and tooltips.
const link = document.createElement("link");
link.rel = "stylesheet";
link.href = chrome.runtime.getURL("main.css");
document.head.appendChild(link);
