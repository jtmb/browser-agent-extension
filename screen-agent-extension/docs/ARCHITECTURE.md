# Screen Agent Architecture

## Overview

Screen Agent is a Chrome MV3 extension that gives an LLM agent control over a browser tab. It uses the **Chrome DevTools Protocol (CDP)** via `chrome.debugger` API for browser automation, and connects to LM Studio for LLM inference. No external processes required — fully self-contained.

## Project Structure

```
screen-agent-extension/
├── background.js          # Service worker: agent loop, tool dispatch, CDP debugger
├── background.bundle.js   # Bundled service worker (built by esbuild)
├── manifest.json          # Chrome MV3 manifest
├── lib/
│   ├── lmstudio.js        # LM Studio API client, SSE parser, system prompt builder
│   ├── mcp-tools.js       # Local tool definitions (file I/O, web search, fetch)
│   ├── tokens.js          # Token counting (gpt-tokenizer wrapper)
│   └── compaction.js      # Conversation summarization for context limits
├── tools/
│   ├── definitions.js     # CDP tool definitions + execution engine (browser_snapshot, click, type, etc.)
│   ├── files.js           # File I/O tools via chrome.storage.local + downloads
│   ├── fetch_webpage.js   # HTTP fetch + text extraction (raw HTML scraping)
│   └── web_search.js      # DuckDuckGo web search with optional sub-agent synthesis
├── src/
│   └── sidepanel/
│       ├── App.tsx        # App shell, theme, layout
│       ├── main.tsx       # React entry point
│       ├── types.ts       # TypeScript type definitions (AgentSettings, ChatMessage, etc.)
│       ├── styles/
│       │   └── app.css    # Global styles (dark/light theme via CSS vars)
│       ├── hooks/
│       │   └── useMessages.ts  # Message state, background communication
│       └── components/
│           ├── ChatWindow.tsx   # Main chat UI
│           ├── ChatInput.tsx    # Message input
│           ├── ChatMessage.tsx  # Single message renderer
│           ├── SettingsPanel.tsx# Settings slide-out
│           └── ProfileUI/      # Profile management
├── control/               # Control page (popup)
├── viewer/                # Screenshot viewer
├── docs/                  # Documentation
├── icons/                 # Extension icons
└── vite.config.ts         # Vite build config
```

## Agent Loop (background.js)

1. Side panel sends `{ type: "agent_chat", userMessage, history, settings }` to service worker
2. Service worker runs the agent loop:
   a. Query active tab → get `pageUrl`
   b. **Debugger attach**: Call `attachToTab(tabId)` to attach `chrome.debugger` to the tab
   c. Load settings from `chrome.storage.local` (merge defaults)
   d. Build tool definitions from `getCdpToolDefinitions()` + `getLocalToolDefinitions()`
   e. **Auto-capture**: Call `executeCdpTool("browser_snapshot")` to get accessibility tree
   f. Check context usage → compact conversation if >70% of context window
   g. Build messages (system prompt + pageUrl + history + snapshot text + user text)
   h. Send context usage to side panel via `{ type: "agent_context" }`
   i. Stream LLM response via LM Studio API (tool-calling mode)
   j. Parse tool calls from response:
      - CDP browser tools → `executeCdpTool(name, args, debuggee)`
      - Local tools → `executeLocalTool(name, args)`
   k. Add tool results to history → loop back to (i) until no more tool calls
3. Final response sent back to side panel via `{ type: "agent_done" }`
4. Debugger stays attached for subsequent turns; detached on tab close

## Communication Flow

```
┌────────────┐   chrome.runtime   ┌───────────────┐   HTTP/SSE    ┌────────────┐
│  SidePanel │ ◄─────────────────► │ Service Worker│ ◄────────────► │  LM Studio  │
│  (React)   │   sendMessage      │ (background)  │               │  (LLM API)  │
└────────────┘                    └───────┬───────┘               └────────────┘
                                          │
                               ┌──────────┴──────────┐
                               │ chrome.debugger API  │
                               │ (Chrome DevTools     │
                               │  Protocol — CDP)     │
                               └──────────┬──────────┘
                                          │
                               ┌──────────┴──────────┐
                               │ Browser Tab         │
                               │ (accessibility tree, │
                               │  click, type, etc.)  │
                               └─────────────────────┘
```

## CDP Engine (tools/definitions.js)

The core browser automation engine uses `chrome.debugger.sendCommand()` to invoke CDP commands directly:

- **Snapshot**: `Accessibility.getFullAXTree` — returns hierarchical accessibility tree
- **Click**: Resolves element ref → `DOM.getBoxModel` → `Input.dispatchMouseEvent` (mousePressed/mouseReleased)
- **Type**: Click to focus → `Input.insertText` → optional Enter
- **Navigate**: `Page.navigate` / `Page.navigateToHistoryEntry`
- **Screenshot**: `Page.captureScreenshot` (JPEG, quality 50)
- **Evaluate**: `Runtime.evaluate` (returnByValue, awaitPromise)
- **Console/Network**: Buffered from `chrome.debugger.onEvent` (Runtime.consoleAPICalled, Log.entryAdded, Network.requestWillBeSent)

### Element Resolution
Elements are referenced by `ref=eNN` identifiers from the accessibility tree. `getElementCenter()` uses `DOM.getBoxModel` with `backendDOMNodeId` to compute the center coordinates for click/hover/drag operations.

## Tool System

### Browser Tools (CDP)
All browser automation goes through `chrome.debugger.sendCommand()`. No external process needed. Tools include: `browser_snapshot`, `browser_click`, `browser_type`, `browser_press_key`, `browser_hover`, `browser_drag`, `browser_navigate`, `browser_navigate_back`, `browser_take_screenshot`, `browser_wait_for`, `browser_evaluate`, `browser_console_messages`, `browser_network_requests`, `browser_handle_dialog`, `browser_select_option`, `browser_file_upload`.

### Local Tools (lib/mcp-tools.js)
Run directly in the extension service worker:
- `web_search` — DuckDuckGo API + optional sub-agent LLM synthesis
- `fetch_webpage` — HTTP fetch + HTML text extraction
- `download_file` — chrome.downloads API
- `write_file`, `read_file`, `list_files`, `delete_file` — chrome.storage.local

### Tool Definitions
`tools/definitions.js` provides `getCdpToolDefinitions()` (18 browser tools in OpenAI format) and `getAllToolDefinitions()` (CDP + local merged). `lib/mcp-tools.js` provides `getLocalToolDefinitions()` (7 local tools).

## Accessibility Snapshots

The primary observation mechanism is `browser_snapshot` (powered by CDP `Accessibility.getFullAXTree`). It returns a textual accessibility tree:

```
- button "Subscribe" [ref=e12]
- textbox "Email address" [ref=e15]
- link "Learn more" [ref=e23]
```

The tree is formatted by `formatAXTree()` which walks AX nodes recursively, emitting role, name, and `backendDOMNodeId` as `[ref=eNN]` identifiers. The snapshot is sent to the LLM as a user message. The system prompt instructs the LLM to reference elements by their `ref` identifiers when calling interaction tools (e.g., `browser_click(element="Subscribe button", ref="e12")`).

## Key Libraries

| Library | Version | Purpose |
|---------|---------|---------|
| React | 18.3.1 | UI framework |
| TypeScript | 5.6 | Type safety |
| Vite | 5.4.21 | Build tool |
| gpt-tokenizer | 3.4.0 | Token counting (cl100k_base) |
| marked | 18.0.5 | Markdown rendering |
| highlight.js | 11.11.1 | Syntax highlighting |
| xlsx | 0.20.x | XLSX/Excel parsing |
| Chrome DevTools Protocol | 1.3 | Browser automation via chrome.debugger |

## Token & Context Management

- **Token counting**: `gpt-tokenizer` with `cl100k_base` encoding
- **Context gauge**: SVG circle in chat, bottom-right, color-coded by usage
- **Compaction**: Auto-summarizes old messages when >70% of context window
- **Snapshot truncation**: Page snapshots are truncated to fit within context limits

## Settings

| Setting | Default | Range |
|---------|---------|-------|
| LM Studio URL | `http://localhost:1234` | Any HTTP URL |
| Model | `qwen/qwen3.5-9b` | Any installed model |
| Max Output Tokens | 16,384 | 256–131,072 |
| Context Window Size | 262,144 | 4,096–1,048,576 |
| Tool Mode | Interactive | Interactive / Describe Only / Off |
| Sub-Agents | Off | On / Off |
| Enabled Tools | All | Per-tool toggles |

## Build Process

```
npm run build
  ├── vite build           → bundles src/sidepanel/ into sidepanel/
  ├── esbuild background.js → bundles background.js + lib/* + gpt-tokenizer → background.bundle.js
  └── esbuild viewer/viewer.js → bundles viewer.js + marked + hljs + xlsx → viewer/viewer.bundle.js
```

## Browser Automation (CDP)

The extension uses Chrome's built-in `chrome.debugger` API — no external server needed. Just load the extension and click the toolbar icon. The debugger attaches automatically on the first agent turn.

**Limitations**: Only one debugger can attach to a tab at a time. Close any DevTools windows before using the extension. The debugger stays attached between turns for performance; it detaches when the tab is closed.
