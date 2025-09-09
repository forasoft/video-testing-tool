//impossible to import
const CONST = {
  VTT_CONTEXT_BTN_CLICK: "VTT_CONTEXT_BTN_CLICK",
  VTT_EXTENSION_BUTTON_CLICK: "VTT_EXTENSION_BUTTON_CLICK",
};

const MENU_ID = "video-testing-tool-menu";

const windowPostMessage = (data) => {
  window.postMessage(data);
}

const handleClick = (info, tab) => {
  if (info.menuItemId !== MENU_ID) {
    return;
  }

  const data = { id: CONST.VTT_CONTEXT_BTN_CLICK };
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: windowPostMessage,
    args: [data],
  })
};

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    title: "Test stream",
    id: MENU_ID,
    contexts: ["video", "page", "selection", "image", "link"],
  });
});

chrome.contextMenus.onClicked.addListener(handleClick);

chrome.action.onClicked.addListener((tab) => {
  const data = { id: CONST.VTT_EXTENSION_BUTTON_CLICK };
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: windowPostMessage,
    args: [data],
  });
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.id) {
    case "some-event":
      sendResponse({ id: "some-event-resp", data: { PI: 3.1415926 } });
      return;
    case "videoElementBeingExplored":
      return;
    default:
      return;
  }
});
