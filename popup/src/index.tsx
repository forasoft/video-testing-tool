import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";
import { MESSAGES, PanelMessage } from "../../shared/protocol";

// The injection sends a second's messages in one VTT_BATCH (PRD §18): they are handed to the panel's listeners one by
// one within this task, so that React draws them all in one render.
window.addEventListener("message", (e) => {
  if (e.data?.id === MESSAGES.VTT_BATCH && Array.isArray(e.data.data)) {
    (e.data.data as PanelMessage[]).forEach((message) => window.dispatchEvent(new MessageEvent("message", { data: message })));
  }
});

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// `vite dev` only: a synthetic session instead of the extension (?mock=compact|expanded&speed=10).
if (import.meta.env.DEV) {
  import("./dev/mockSession").then(({ startMockSession }) => setTimeout(startMockSession, 200));
}
