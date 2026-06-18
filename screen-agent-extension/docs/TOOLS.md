# Tools Reference

Screen Agent provides **25 tools** across two categories: **Browser Automation** (via Chrome DevTools Protocol / `chrome.debugger`) and **Local Utilities** (web search, file I/O). Tools can be toggled in Settings.

All browser tools execute directly in the extension via CDP — no external server needed. The accessibility tree (`Accessibility.getFullAXTree`) provides a complete snapshot of every page, so the LLM can see all interactive elements and their `ref` identifiers.

## Architecture

```
┌──────────────┐   chrome.debugger (CDP)   ┌──────────┐
│  background.js│ ◄───────────────────────► │ Browser  │
│  (CDP engine) │   Accessibility, Input,   │ Tab      │
│               │   Page, Runtime domains   │          │
└──────────────┘                           └──────────┘
```

## Tool Index

### Browser Automation (CDP)

| Tool | Description | Docs |
|------|-------------|------|
| `browser_snapshot` | Capture accessibility tree snapshot of the page (main observability tool) | [browser_snapshot.md](tools/browser_snapshot.md) |
| `browser_click` | Click an element by ref or description | [browser_click.md](tools/browser_click.md) |
| `browser_type` | Type text into an element | [browser_type.md](tools/browser_type.md) |
| `browser_press_key` | Press a keyboard key | [browser_press_key.md](tools/browser_press_key.md) |
| `browser_hover` | Hover over an element | [browser_hover.md](tools/browser_hover.md) |
| `browser_navigate` | Navigate to a URL | [browser_navigate.md](tools/browser_navigate.md) |
| `browser_navigate_back` | Go back in history | [browser_navigate_back.md](tools/browser_navigate_back.md) |
| `browser_wait_for` | Wait for text, time, or element state | [browser_wait_for.md](tools/browser_wait_for.md) |
| `browser_take_screenshot` | Capture a page screenshot | [browser_take_screenshot.md](tools/browser_take_screenshot.md) |
| `browser_evaluate` | Run JavaScript in page context | [browser_evaluate.md](tools/browser_evaluate.md) |
| `browser_fill_form` | Fill multiple form fields at once | [browser_fill_form.md](tools/browser_fill_form.md) |
| `browser_select_option` | Select a dropdown option | [browser_select_option.md](tools/browser_select_option.md) |
| `browser_drag` | Drag and drop an element | [browser_drag.md](tools/browser_drag.md) |
| `browser_handle_dialog` | Accept/dismiss browser dialogs | [browser_handle_dialog.md](tools/browser_handle_dialog.md) |
| `browser_tabs` | Tab management (list, create, close, select) | [browser_tabs.md](tools/browser_tabs.md) |
| `browser_console_messages` | Read browser console output | [browser_console_messages.md](tools/browser_console_messages.md) |
| `browser_network_requests` | Read network request log | [browser_network_requests.md](tools/browser_network_requests.md) |
| `browser_file_upload` | Upload files to the page | [browser_file_upload.md](tools/browser_file_upload.md) |

### Local Utilities

| Tool | Description | Docs |
|------|-------------|------|
| `web_search` | Search the web using DuckDuckGo + optional sub-agent synthesis | [web_search.md](tools/web_search.md) |
| `fetch_webpage` | Fetch and extract text from an arbitrary URL (raw HTTP) | [fetch_webpage.md](tools/fetch_webpage.md) |
| `download_file` | Download a file from a URL to the user's computer | [download_file.md](tools/download_file.md) |
| `write_file` | Create or overwrite a file in persistent storage | [write_file.md](tools/write_file.md) |
| `read_file` | Read a file from persistent storage | [read_file.md](tools/read_file.md) |
| `list_files` | List all stored files | [list_files.md](tools/list_files.md) |
| `delete_file` | Delete a file from persistent storage | [delete_file.md](tools/delete_file.md) |

## Observe-Only Tools

These tools are always available (no side effects):

- `browser_snapshot` — primary page observability
- `browser_take_screenshot` — visual inspection
- `browser_evaluate` — read-only JS execution
- `browser_console_messages` — console log inspection
- `browser_network_requests` — network activity inspection

## Scraping Strategy

With Playwright MCP, the agent uses **accessibility snapshots** for page content:

1. **`browser_snapshot`** (first choice) — Captures the full accessibility tree. Shows all interactive elements with `ref` identifiers, text content, and element roles.
2. **`browser_evaluate`** — For targeted data extraction (e.g., `document.querySelectorAll(...)`).
3. **`fetch_webpage`** — For pages not in the current browser tab (raw HTTP fetch).
4. **`browser_take_screenshot`** (last resort) — Visual inspection only.

### Snapshot Format

The `browser_snapshot` tool returns a textual accessibility tree with `ref` identifiers:

```
- button "Subscribe" [ref=e12]
- textbox "Email address" [ref=e15]
- link "Learn more" [ref=e23]
```

The LLM references elements by their `ref` values when calling tools like `browser_click` or `browser_type`.

### Follow-Through Rule

After scraping data via `browser_evaluate`, `fetch_webpage`, or `browser_snapshot`, the agent MUST parse results into structured rows and call `write_file(name, csv_content)` to save results.

## Adding a New Tool

When adding a new local tool, update all of these:

1. **`background.js`** — Add to `executeLocalTool()` dispatch
2. **`lib/mcp-tools.js`** — Add to `getLocalToolDefinitions()` and `LOCAL_TOOL_NAMES`
3. **`src/sidepanel/types.ts`** — Add any new result types
4. **`src/sidepanel/components/SettingsPanel.tsx`**:
   - Add display name to `TOOL_LABELS`
   - Add the ID to `ALL_TOOL_NAMES`
   - If it should always be available, add to `OBSERVE_TOOLS`
5. **`docs/tools/<tool_name>.md`** — Create per-tool documentation page
6. **`docs/TOOLS.md`** (this file) — Add to the tool index table

Browser CDP tools are implemented in `tools/definitions.js` via `chrome.debugger.sendCommand()`.
