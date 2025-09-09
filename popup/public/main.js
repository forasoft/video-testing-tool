const CONST = {
  VTT_HIDE: "VTT_HIDE",
  VTT_WAS_HIDDEN: "VTT_WAS_HIDDEN",
  VTT_EXTENSION_BUTTON_CLICK: "VTT_EXTENSION_BUTTON_CLICK",
  VTT_DOWNLOAD_BUTTON_CLICK: "VTT_DOWNLOAD_BUTTON_CLICK",
  VTT_IS_MAIN_SCREEN: "VTT_IS_MAIN_SCREEN",
  VTT_RESIZE_BUTTON_CLICK: "VTT_RESIZE_BUTTON_CLICK",
  VTT_SET_FULL_SIZE: "VTT_SET_FULL_SIZE",
  CONTEXT_MENU_VTT_WAS_CLICKED: "CONTEXT_MENU_VTT_WAS_CLICKED",
};

function inject({ url, id }) {
  const injectJS = document.createElement("script");
  injectJS.setAttribute("charset", "utf-8");
  injectJS.type = "text/javascript";
  injectJS.src = chrome.runtime.getURL(url);
  injectJS.id = id;
  document.head.insertBefore(injectJS, document.head.childNodes[0]);
}
inject({ url: "injection.js", id: "video-testing-tool" });

const frameContainer = document.createElement("div");
frameContainer.id = "vttFrameContainer";
frameContainer.classList.add("VTT_frameContainer");
frameContainer.classList.add("VTT_displayNone");

const frameWrapper = document.createElement("div");
frameWrapper.style.top = "10px";
frameWrapper.style.right = "10px";
frameWrapper.classList.add("VTT_frameWrapper");

const header = document.createElement("header");
header.classList.add("VTT_header");
header.addEventListener("pointerdown", handleDragFrame);

const title = document.createElement("div");
title.innerText = "StreamTest";
title.classList.add("VTT_headerTitle");

const download = document.createElement("button");
download.innerHTML = `
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
    <rect width="34" height="34" rx="17" fill="#1D1D1B" fill-opacity="0.06" />
    <path d="M17.3125 23.5V12.5M17.3125 23.5L13.3125 19.8333M17.3125 23.5L21.3125 19.8333" stroke="#A3A5A7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>
`;
download.addEventListener("click", handleClickDownloadButton);
download.classList.add("VTT_headerButton");

const downloadTooltip = document.createElement("div");
downloadTooltip.innerText = "Download logs";
downloadTooltip.classList.add("VTT_buttonTooltip");

const resize = document.createElement("button");
resize.innerHTML = `
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
    <rect x="0.987061" y="0.855469" width="34" height="34" rx="17" fill="#1D1D1B" fill-opacity="0.06"/>
    <path fill-rule="evenodd" clip-rule="evenodd" d="M11.9871 14.2305C11.9871 12.9188 13.0504 11.8555 14.3621 11.8555C14.9144 11.8555 15.3621 11.4078 15.3621 10.8555C15.3621 10.3032 14.9144 9.85547 14.3621 9.85547C11.9458 9.85547 9.98707 11.8142 9.98707 14.2305V18.4555L9.98707 18.4983C9.98706 19.5821 9.98705 20.4562 10.0449 21.1641C10.1044 21.8929 10.2302 22.5331 10.532 23.1254C11.0114 24.0662 11.7763 24.8311 12.7171 25.3105C13.3094 25.6123 13.9496 25.7381 14.6784 25.7977C15.3863 25.8555 16.2605 25.8555 17.3443 25.8555H17.3871H21.6121C24.0283 25.8555 25.9871 23.8967 25.9871 21.4805C25.9871 20.9282 25.5394 20.4805 24.9871 20.4805C24.4348 20.4805 23.9871 20.9282 23.9871 21.4805C23.9871 22.7922 22.9237 23.8555 21.6121 23.8555H17.3871C16.2505 23.8555 15.4581 23.8547 14.8413 23.8043C14.2361 23.7549 13.8884 23.6627 13.6251 23.5285C13.0606 23.2409 12.6017 22.7819 12.314 22.2174C12.1799 21.9541 12.0877 21.6064 12.0382 21.0012C11.9878 20.3844 11.9871 19.5921 11.9871 18.4555V14.2305ZM25.3669 11.5746C25.7574 11.1841 25.7574 10.5509 25.3669 10.1604C24.9764 9.76984 24.3432 9.76984 23.9527 10.1604L20.8006 13.3124L20.8006 10.8674C20.8006 10.3151 20.3529 9.86743 19.8006 9.86743C19.2484 9.86743 18.8006 10.3151 18.8006 10.8674L18.8006 15.7266C18.8006 16.2788 19.2484 16.7266 19.8006 16.7266L25.0685 16.7266C25.6208 16.7266 26.0685 16.2788 26.0685 15.7266C26.0685 15.1743 25.6208 14.7266 25.0685 14.7266L22.2149 14.7266L25.3669 11.5746Z" fill="#A3A5A7"/>
  </svg>
`;
resize.addEventListener("click", handleClickResizeButton);
resize.classList.add("VTT_headerButton", "VTT_resizeIcon");

const resizeTooltip = document.createElement("div");
resizeTooltip.innerText = "Resize";
resizeTooltip.classList.add("VTT_buttonTooltip");

const cross = document.createElement("button");
cross.innerHTML = `
  <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
    <rect width="34" height="34" rx="17" fill="#1D1D1B" fill-opacity="0.06" />
    <path d="M12.75 12.75L21.9583 21.9583" stroke="#A3A5A7" stroke-width="2" stroke-linecap="round" />
    <path d="M21.9583 12.75L12.7499 21.9583" stroke="#A3A5A7" stroke-width="2" stroke-linecap="round" />
  </svg>
`;
cross.addEventListener("click", toggleDisplayFrameContainer);
cross.classList.add("VTT_headerButton");

const frame = document.createElement("iframe");
frame.src = chrome.runtime.getURL("/index.html");
frame.id = "vttFrame";
frame.name = "vttFrame";
frame.classList.add("VTT_characteristicContainer");

header.appendChild(title);
download.appendChild(downloadTooltip);
header.appendChild(download);
resize.appendChild(resizeTooltip);
header.appendChild(resize);
header.appendChild(cross);
frameWrapper.appendChild(header);
frameWrapper.appendChild(frame);
frameContainer.appendChild(frameWrapper);
document.body.appendChild(frameContainer);

function handleDragFrame(e) {
  if (
    e.path.includes(cross) ||
    e.path.includes(download) ||
    e.path.includes(resize)
  ) {
    return;
  }
  e.preventDefault();

  frameWrapper.style.pointerEvents = "none";
  frameContainer.style.pointerEvents = "auto";
  frameContainer.style.cursor = "move";
  const frameShiftX = parseInt(frameWrapper.style.right);
  const frameShiftY = parseInt(frameWrapper.style.top);
  const maxRight = frameContainer.offsetWidth - frameWrapper.offsetWidth * 0.3;
  const minRight = -frameWrapper.offsetWidth * 0.7;
  const maxTop = frameContainer.offsetHeight - header.offsetHeight;
  const clientX = e.clientX;
  const clientY = e.clientY;

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

  function removeMoveFrameHandler() {
    frameWrapper.style.pointerEvents = "auto";
    frameContainer.style.pointerEvents = "none";
    frameContainer.style.cursor = "inherit";
    document.removeEventListener("pointermove", moveFrameHandler);
  }

  document.addEventListener("pointermove", moveFrameHandler);
  document.addEventListener("pointerleave", removeMoveFrameHandler);
  document.addEventListener("pointerup", removeMoveFrameHandler);
}

function handleClickDownloadButton() {
  const event = new Event(CONST.VTT_DOWNLOAD_BUTTON_CLICK);
  window.dispatchEvent(event);
}

function handleClickResizeButton(e, setFullSize) {
  console.log("handleClickResizeButton", setFullSize);
  let fullSize = true;
  if (title.classList.contains("VTT_displayNone")) {
    title.classList.remove("VTT_displayNone");
    header.classList.remove("VTT_headerSmallSize");
    frame.classList.remove("VTT_characteristicContainerSmallSize");

    const svg = resize.querySelector("svg");
    svg.innerHTML = `
        <rect x="0.987061" y="0.855469" width="34" height="34" rx="17" fill="#1D1D1B" fill-opacity="0.06"/>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M11.9871 14.2305C11.9871 12.9188 13.0504 11.8555 14.3621 11.8555C14.9144 11.8555 15.3621 11.4078 15.3621 10.8555C15.3621 10.3032 14.9144 9.85547 14.3621 9.85547C11.9458 9.85547 9.98707 11.8142 9.98707 14.2305V18.4555L9.98707 18.4983C9.98706 19.5821 9.98705 20.4562 10.0449 21.1641C10.1044 21.8929 10.2302 22.5331 10.532 23.1254C11.0114 24.0662 11.7763 24.8311 12.7171 25.3105C13.3094 25.6123 13.9496 25.7381 14.6784 25.7977C15.3863 25.8555 16.2605 25.8555 17.3443 25.8555H17.3871H21.6121C24.0283 25.8555 25.9871 23.8967 25.9871 21.4805C25.9871 20.9282 25.5394 20.4805 24.9871 20.4805C24.4348 20.4805 23.9871 20.9282 23.9871 21.4805C23.9871 22.7922 22.9237 23.8555 21.6121 23.8555H17.3871C16.2505 23.8555 15.4581 23.8547 14.8413 23.8043C14.2361 23.7549 13.8884 23.6627 13.6251 23.5285C13.0606 23.2409 12.6017 22.7819 12.314 22.2174C12.1799 21.9541 12.0877 21.6064 12.0382 21.0012C11.9878 20.3844 11.9871 19.5921 11.9871 18.4555V14.2305ZM25.3669 11.5746C25.7574 11.1841 25.7574 10.5509 25.3669 10.1604C24.9764 9.76984 24.3432 9.76984 23.9527 10.1604L20.8006 13.3124L20.8006 10.8674C20.8006 10.3151 20.3529 9.86743 19.8006 9.86743C19.2484 9.86743 18.8006 10.3151 18.8006 10.8674L18.8006 15.7266C18.8006 16.2788 19.2484 16.7266 19.8006 16.7266L25.0685 16.7266C25.6208 16.7266 26.0685 16.2788 26.0685 15.7266C26.0685 15.1743 25.6208 14.7266 25.0685 14.7266L22.2149 14.7266L25.3669 11.5746Z" fill="#A3A5A7"/>
    `;
  } else if (!setFullSize) {
    title.classList.add("VTT_displayNone");
    header.classList.add("VTT_headerSmallSize");
    frame.classList.add("VTT_characteristicContainerSmallSize");

    const svg = resize.querySelector("svg");
    svg.innerHTML = `
        <rect width="34" height="34" rx="17" fill="#1D1D1B" fill-opacity="0.06"/>
        <path fill-rule="evenodd" clip-rule="evenodd" d="M11 13.375C11 12.0633 12.0633 11 13.375 11C13.9273 11 14.375 10.5523 14.375 10C14.375 9.44772 13.9273 9.00001 13.375 9.00001C10.9588 9.00001 9.00001 10.9588 9.00001 13.375V17.6L9.00001 17.6428C8.99999 18.7266 8.99999 19.6007 9.05782 20.3086C9.11737 21.0375 9.24319 21.6777 9.54497 22.27C10.0243 23.2108 10.7892 23.9757 11.7301 24.455C12.3223 24.7568 12.9625 24.8826 13.6914 24.9422C14.3993 25 15.2734 25 16.3572 25H16.4H20.625C23.0413 25 25 23.0413 25 20.625C25 20.0727 24.5523 19.625 24 19.625C23.4477 19.625 23 20.0727 23 20.625C23 21.9367 21.9367 23 20.625 23H16.4C15.2634 23 14.4711 22.9992 13.8542 22.9488C13.2491 22.8994 12.9014 22.8072 12.638 22.673C12.0735 22.3854 11.6146 21.9265 11.327 21.362C11.1928 21.0986 11.1006 20.7509 11.0512 20.1458C11.0008 19.5289 11 18.7366 11 17.6V13.375ZM18.1094 14.4791C17.7189 14.8697 17.7189 15.5028 18.1094 15.8933C18.5 16.2839 19.1331 16.2839 19.5237 15.8933L22.9881 12.4289L22.9881 15.1863C22.9881 15.7386 23.4358 16.1863 23.9881 16.1863C24.5404 16.1863 24.9881 15.7386 24.9881 15.1863L24.9881 10.0147C24.9881 9.46243 24.5404 9.01471 23.9881 9.01471L18.3815 9.01471C17.8292 9.01471 17.3815 9.46243 17.3815 10.0147C17.3815 10.567 17.8292 11.0147 18.3815 11.0147L21.5739 11.0147L18.1094 14.4791Z" fill="#A3A5A7"/>
    `;
    fullSize = false;
  }

  window.frames.vttFrame.postMessage(
    {
      id: CONST.VTT_RESIZE_BUTTON_CLICK,
      data: { fullSize },
    },
    "*"
  );
}

function toggleDisplayFrameContainer(e, open) {
  if (frameContainer.classList.contains("VTT_displayNone")) {
    frameContainer.classList.remove("VTT_displayNone");
  } else if (!open) {
    frameContainer.classList.add("VTT_displayNone");
    window.frames.vttFrame.postMessage({ id: CONST.VTT_WAS_HIDDEN }, "*");
  }
}

window.addEventListener("message", (e) => {
  if (CONST.VTT_HIDE === e.data.id) {
    toggleDisplayFrameContainer();
  }
  if (CONST.VTT_EXTENSION_BUTTON_CLICK === e.data.id) {
    toggleDisplayFrameContainer();
    download.classList.remove("VTT_headerButton");
    download.classList.add("VTT_displayNone");

    resize.classList.remove("VTT_headerButton");
    resize.classList.add("VTT_displayNone");
    handleClickResizeButton(null, true);
  }
  if (CONST.VTT_IS_MAIN_SCREEN === e.data.id && !e.data.value) {
    download.classList.add("VTT_headerButton");
    download.classList.remove("VTT_displayNone");

    resize.classList.add("VTT_headerButton");
    resize.classList.remove("VTT_displayNone");
  }
  if (
    CONST.VTT_IS_MAIN_SCREEN === e.data.id &&
    e.data.value &&
    !frameContainer.classList.contains("VTT_displayNone")
  ) {
    download.classList.remove("VTT_headerButton");
    download.classList.add("VTT_displayNone");

    resize.classList.remove("VTT_headerButton");
    resize.classList.add("VTT_displayNone");
    handleClickResizeButton(null, true);
  }
  if (CONST.VTT_SET_FULL_SIZE === e.data.id) {
    handleClickResizeButton(null, true);
  }
});

window.addEventListener(CONST.VTT_SET_FULL_SIZE, () =>
  handleClickResizeButton(null, true)
);
window.addEventListener(CONST.CONTEXT_MENU_VTT_WAS_CLICKED, () =>
  toggleDisplayFrameContainer(null, true)
);

const css = `
  .VTT_frameContainer {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Roboto", "Oxygen",
      "Ubuntu", "Cantarell", "Fira Sans", "Droid Sans", "Helvetica Neue",
      sans-serif;
    -webkit-font-smoothing: antialiased;
    position: fixed;
    top: 0;
    right: 0;
    left: 0;
    bottom: 0;
    margin: 0;
    padding: 0;
    z-index: 9999999;
    pointer-events: none;
    display: block;
  }

  .VTT_frameWrapper {
    position: absolute;
    top: 10px;
    right: 10px;
    width: auto;
    height: auto;
    margin: 0;
    padding: 0;
    pointer-events: auto;
    background: #f7f7f8;
    border-radius: 10px;
    box-shadow: 0px 0px 1px;
    overflow: hidden;
  }

  .VTT_header {
    box-sizing: border-box;
    width: 350px;
    display: flex;
    align-items: center;
    padding: 15px;
    cursor: move;
    transition: width 0.3s;
  }

  .VTT_headerSmallSize {
    width: 190px;
  }

  .VTT_headerTitle {
    font-weight: 500;
    color: #1d1d1b;
    font-size: 20px;
    line-height: 24px;
    white-space: nowrap;
  }

  .VTT_headerButton {
    position: relative;
    margin: 0;
    margin-left: auto;
    width: auto;
    padding: 0;
    background: none !important;
    border: none;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .VTT_headerButton:hover path {
    stroke: #1d1d1b;
  }

  .VTT_resizeIcon:hover path {
    stroke: none;
    fill: #1d1d1b;
  }

  .VTT_headerButton + .VTT_headerButton{
    margin-left: 10px;
  }

  .VTT_buttonTooltip {
    position: absolute;
    top: calc(100% + 7px);
    left: 50%;
    transform: translateX(-50%);

    display: none;
    flex-direction: row;
    justify-content: center;
    align-items: center;

    border-radius:10px;
    padding: 10px 16px;
    box-shadow: 0px 10px 60px rgba(0, 0, 0, 0.1);
    background: #1d1d1b;

    color: #ffffff;
    font-size: 16px;
    line-height: 24px;
    white-space: nowrap
  }

  .VTT_headerButton:hover .VTT_buttonTooltip {
    display: flex;
  }

  .VTT_characteristicContainer {
    border: none;
    width: 350px;
    height: 520px;
    margin: 0;
    padding: 0;
    border-radius: 10px;
    transition: width 0.3s
  }

  .VTT_characteristicContainerSmallSize {
    width: 190px;
  }

  .VTT_displayNone {
    display: none !important;
  }
`;
const styleCross = document.createElement("style");
if (styleCross.styleSheet) {
  styleCross.styleSheet.cssText = css;
} else {
  styleCross.appendChild(document.createTextNode(css));
}
document.head.appendChild(styleCross);
