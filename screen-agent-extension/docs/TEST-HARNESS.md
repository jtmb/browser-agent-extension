# Test Harness

## Overview

`test-harness.html` is a standalone web page that tests the Screen Agent extension's tool execution API without involving the LLM. It connects via `chrome.runtime.connectExternal` (Chrome MV3 cross-extension messaging) to send direct tool commands and observe results.

**Why it exists:** The LLM-based Screen Agent is end-to-end — you type in the sidepanel, the LLM decides which tools to call. That makes debugging individual tools slow. The harness bypasses the LLM entirely, letting you send `{ action: "click_element", index: 5 }` and see the raw response immediately.

## Setup

1. **Start a local server** (must be localhost — the extension only accepts `externally_connectable` from `localhost:*`):
   ```bash
   cd screen-agent-extension
   python3 -m http.server 9876
   ```

2. **Open in Chrome:**
   ```
   http://localhost:9876/test-harness.html
   ```

3. **Get the extension ID** from `chrome://extensions` — find "Screen Agent" and copy the 32-character ID.

4. **Click "Connect to Extension"** and paste the ID. The green status dot confirms connection.

5. **Navigate to a test page** in another Chrome tab (e.g., `https://lichess.org/analysis`). The extension operates on whichever tab is active.

## Available Actions

| Button | Action | What It Tests |
|--------|--------|--------------|
| 📋 Get Elements | `get_elements` | DOM element extraction via `Runtime.evaluate` — returns interactive elements with bounding boxes |
| 📸 Screenshot | `screenshot` | `Page.captureScreenshot` — returns base64 image (length shown in log) |
| 👆 Click e2 Pawn | `get_elements` → `click_element` | Two-step flow: extract elements, then click element at index 0 via CDP mouse events |
| ▶️ Run Full Test | `get_elements` → `screenshot` → `click_coords` | Full pipeline: extract → capture → coordinate click at e2 pawn center (302, 476) |

## Communication Flow

```
test-harness.html          background.js            Chrome Debugger
      │                         │                         │
      │── connectExternal ─────▶│                         │
      │                         │                         │
      │── { action: "get_elements" } ──▶│                 │
      │                         │── attach ─────────────▶│
      │                         │── Runtime.evaluate ───▶│
      │                         │◀── elements[] ────────│
      │                         │── detach ─────────────▶│
      │◀── { ok: true, elements[], count } ──│           │
      │                         │                         │
      │── { action: "click_element", index: 0 } ──▶│     │
      │                         │── attach ─────────────▶│
      │                         │── extractPageElements ─▶│
      │                         │── Input.dispatchMouseEvent ──▶│
      │                         │── detach ─────────────▶│
      │◀── { ok: true, method: "coordinate-click" } ──│   │
```

## How It Relates to the Agent Loop

Normally the full flow is: **User → Sidepanel → background.js → LLM → tool execution → LLM → Sidepanel**. The harness replaces "LLM" with hardcoded action sequences. This lets you:

- **Validate tool output shape** — does `click_element` return the fields you expect?
- **Test timing** — is the debugger attach/detach cycle fast enough?
- **Debug CDP errors** — raw error messages without LLM interpretation
- **Verify click behavior** — did the element actually get selected on the page?

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| "Connection failed" | Extension not loaded or wrong ID | Verify extension is enabled at `chrome://extensions` |
| "No active tab" | No Chrome tabs open | Open any tab before sending actions |
| Actions work but no visible effect | Active tab isn't the test page | Click into the lichess tab before sending |
| Port disconnects after one action | Extension background service worker went idle | Chrome keeps MV3 workers alive ~30s; send actions promptly |
| `click_element` returns success but nothing happened | Element at index 0 isn't a chess piece | Check the elements list log — adjust index or use `click_coords` |

## Implementation Notes

- **No build step needed** — plain HTML/JS, served directly from disk.
- **Extension ID is cached** in `localStorage` so you don't need to paste it every time.
- **The harness does NOT require the LLM** — it uses `chrome.runtime.connectExternal` to hit the same `onConnectExternal` handler that the LLM-based agent uses (background.js lines 114–185).
- **Each action attaches/detaches the debugger** — this means consecutive actions have a brief overhead. The 2-second pauses in `runFullTest()` account for this.
