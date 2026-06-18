/**
 * Side panel entry point — mounts the React app into the extension side panel.
 */
import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App";
import "./styles/themes.css";
import "./styles/app.css";

// ── Side Panel Toggle ─────────────────────────────────────────────────────
// The background service worker sends a close_side_panel message when the
// toolbar icon is clicked and the panel is already open. We also notify
// the background when the panel closes via its own X button so tracking
// stays in sync.

if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
  // Listen for the background telling us to close
  chrome.runtime.onMessage.addListener((msg: Record<string, unknown>) => {
    if (msg.type === "close_side_panel") {
      window.close();
    }
  });

  // Tell the background when we close so the toggle stays in sync
  window.addEventListener("beforeunload", () => {
    chrome.runtime.sendMessage({ type: "side_panel_closed" });
  });
}

const root = document.getElementById("root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}
