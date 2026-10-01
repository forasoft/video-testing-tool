// The popup's entry, loaded by the panel's iframe (index.html): it renders the panel.
import React from "react";
import ReactDOM from "react-dom/client";
import "./index.css";
import App from "./App";

const root = ReactDOM.createRoot(document.getElementById("root") as HTMLElement);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

// `vite dev` only: a synthetic session instead of the extension (?mock=compact|expanded&speed=10).
if (import.meta.env.DEV) {
  void import("./dev/mockSession").then(({ startMockSession }) => setTimeout(startMockSession, 200));
}
