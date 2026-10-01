// The extension's service worker: the "Test stream" context menu item and the toolbar button. Each click reaches the
// page as a window.postMessage run in the tab (chrome.scripting): main.js and the injection listen there.

//impossible to import
const CONST = {
  VTT_CONTEXT_BTN_CLICK: "VTT_CONTEXT_BTN_CLICK",
  VTT_EXTENSION_BUTTON_CLICK: "VTT_EXTENSION_BUTTON_CLICK",
};

const MENU_ID = "video-testing-tool-menu";

// Runs in the tab, not here: chrome.scripting serializes the function, so it may use nothing but its arguments.
const windowPostMessage = (data) => {
  window.postMessage(data);
}

// Test stream: the injection starts a session on the video under the last right-click.
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

// Created on install and update only: Chrome keeps the item while the service worker is stopped. It is offered over
// any element, not only a <video>: the injection finds the video under the click by its coordinates.
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    title: "Test stream",
    id: MENU_ID,
    contexts: ["video", "page", "selection", "image", "link"],
  });
});

chrome.contextMenus.onClicked.addListener(handleClick);

// The toolbar button: main.js shows or hides the panel.
chrome.action.onClicked.addListener((tab) => {
  const data = { id: CONST.VTT_EXTENSION_BUTTON_CLICK };
  chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: windowPostMessage,
    args: [data],
  });
});
