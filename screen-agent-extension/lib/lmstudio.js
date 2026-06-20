/**
 * LM Studio API client for the Screen Agent extension.
 * Handles chat completions with streaming, vision (image_url), and tool-calling.
 *
 * LM Studio exposes an OpenAI-compatible endpoint at /v1/chat/completions.
 * This module wraps it with defaults tuned for the Screen Agent use case.
 */

const DEFAULT_BASE_URL = "http://127.0.0.1:1234/v1";
const DEFAULT_MODEL = "qwen/qwen3.5-9b";
const DEFAULT_MAX_TOKENS = 16384;

/**
 * Build the standard system prompt that instructs the LLM how to act as a
 * screen-aware agent with Playwright MCP browser tools available.
 *
 * The prompt explains the accessibility snapshot format: elements have ref
 * identifiers (e.g., ref=e42) that the LLM uses to target elements.
 *
 * @param {object} [opts={}]
 * @param {string} [opts.customPrompt] - Override the default system prompt
 * @param {boolean} [opts.toolMode=false] - If false (describe-only), the LLM is told it can only observe
 * @returns {string}
 */
export function buildSystemPrompt(opts = {}) {
  const toolMode = opts.toolMode === true;

  const toolInstructions = toolMode
    ? "\n" +
      "YOUR TOOLS (CDP browser automation):\n" +
      "- browser_snapshot() — Capture the accessibility tree of the current page. ALWAYS use this FIRST.\n" +
      "  Elements have ref identifiers (e.g., ref=e42) — use for browser_click, browser_type, etc.\n" +
      "- browser_click(element, ref?, doubleClick?, button?) — Click an element by its ref from the snapshot.\n" +
      "- browser_type(element, text, submit?) — Type text into an element by ref.\n" +
      "- browser_press_key(key) — Press a key (Enter, Tab, Escape, ArrowUp, etc.).\n" +
      "- browser_hover(element) — Hover over an element by ref.\n" +
      "- browser_navigate(url) — Go to a URL.\n" +
      "- browser_navigate_back() — Go back to the previous page.\n" +
      "- browser_wait_for(time?, text?, textGone?) — Wait for time (seconds).\n" +
      "- browser_take_screenshot(element?, type?) — Take a screenshot (visual inspection only).\n" +
      "- browser_evaluate(function) — Run JavaScript on the page.\n" +
      "- browser_fill_form(fields) — Fill multiple form fields at once.\n" +
      "- browser_select_option(element, values) — Select dropdown options.\n" +
      "- browser_drag(startElement, endElement) — Drag and drop.\n" +
      "- browser_handle_dialog(accept, promptText?) — Accept/dismiss dialogs.\n" +
      "- browser_tabs(action, index?) — List, create, close, or select browser tabs.\n" +
      "- browser_console_messages() — Get browser console output.\n" +
      "- browser_network_requests() — List network requests.\n" +
      "- web_search(query) — Search the web (DuckDuckGo).\n" +
      "- fetch_webpage(url) — Fetch text from a URL via HTTP.\n" +
      "- download_file(url, filename?) — Download a file.\n" +
      "- write_file(name, content) — Save data to a persistent file.\n" +
      "- read_file(name) — Read a saved file.\n" +
      "- list_files() — List saved files.\n" +
      "- delete_file(name) — Delete a saved file.\n" +
      "\n" +
      "SNAPSHOT RULES:\n" +
      "- The page snapshot is your eyes. It uses accessibility tree format — elements have ref identifiers (e.g., ref=e42).\n" +
      "- Click elements by their ref: browser_click({ element: 'e42' }).\n" +
      "- If the snapshot doesn't show what you need, call browser_snapshot again.\n" +
      "- Screenshots (browser_take_screenshot) are for visual inspection only — you CANNOT click based on screenshots.\n"
    : "\n" +
      "YOUR TOOLS (observe-only):\n" +
      "- browser_snapshot() — Capture page accessibility tree.\n" +
      "- browser_take_screenshot() — Take a screenshot.\n" +
      "- web_search(query) — Search the web.\n" +
      "- fetch_webpage(url) — Fetch text from a URL.\n" +
      "- download_file(url) — Download a file.\n" +
      "- write_file(name, content) — Save data.\n" +
      "- read_file(name) — Read a saved file.\n" +
      "- list_files() — List saved files.\n" +
      "- delete_file(name) — Delete a saved file.\n" +
      "\n" +
      "You are in DESCRIBE-ONLY mode. Observe and report — no clicking, typing, or interacting.\n";

  const screenContext =
    "You are a browser automation agent. You can see the user's screen.\n" +
    "\n" +
    "Every turn, you receive a page snapshot in accessibility tree format.\n" +
    "Elements have ref identifiers (e.g., ref=e42) — use these to interact.\n" +
    "Example snapshot excerpt:\n" +
    "  - button \"Submit\" [ref=e10]\n" +
    "  - textbox \"Search\" [ref=e12]\n" +
    "  - link \"Home\" [ref=e5] [cursor=pointer]\n";

  // When a custom prompt is provided, it replaces the screen context BUT
  // tool instructions are always appended — the user cannot remove them.
  if (opts.customPrompt && opts.customPrompt.trim().length > 0) {
    return opts.customPrompt.trim() + "\n\n" + toolInstructions;
  }

  return screenContext + toolInstructions;
}

/**
 * Parse a Server-Sent Events (SSE) stream from LM Studio.
 * Yields parsed JSON objects as they arrive.
 *
 * @param {ReadableStream<Uint8Array>} body - The fetch response body
 * @param {AbortSignal} [signal] - Optional abort signal
 * @returns {AsyncGenerator<object>}
 */
async function* parseSSEStream(body, signal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith("data: ")) continue;
        const data = trimmed.slice(6);
        if (data === "[DONE]") return;
        try {
          const parsed = JSON.parse(data);
          yield parsed;
        } catch {
          // Skip unparseable chunks
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Normalize a chat completion response from models (like qwen) that
 * emit tool calls inside `reasoning_content` instead of the `tool_calls` array.
 *
 * When ALL choices have empty `content` and empty `tool_calls` but have
 * `reasoning_content` containing `<tool_call>` blocks, we extract the
 * function name and parameters and inject them into `tool_calls`.
 *
 * Supports two reasoning_content formats:
 *   1. XML-style: <function=NAME><parameter=KEY>VALUE</parameter></function>
 *   2. JSON-style: {"name":"NAME","arguments":{"KEY":"VALUE"}}
 *
 * @param {object} json - The parsed chat completion response (mutated in place)
 */
function normalizeReasoningToolCalls(json) {
  if (!json.choices || json.choices.length === 0) return;

  for (const choice of json.choices) {
    const msg = choice.message;
    if (!msg) continue;

    // Only intervene when both content and tool_calls are empty
    const hasContent = msg.content && msg.content.trim().length > 0;
    const hasToolCalls = msg.tool_calls && msg.tool_calls.length > 0;
    if (hasContent || hasToolCalls) continue;

    const reasoning = msg.reasoning_content;
    if (!reasoning || reasoning.indexOf("<tool_call>") === -1) continue;

    const toolCalls = parseToolCallsFromReasoning(reasoning);
    if (toolCalls.length === 0) continue;

    msg.tool_calls = toolCalls;
    // Clear reasoning_content so downstream doesn't get confused
    msg.reasoning_content = "";
  }
}

/**
 * Parse tool calls from a reasoning_content string.
 *
 * @param {string} reasoning - The reasoning_content text
 * @returns {object[]} Array of tool_call objects in OpenAI format
 */
export function parseToolCallsFromReasoning(reasoning) {
  const toolCalls = [];

  // Split on <tool_call> ... </tool_call> blocks
  const blockRegex = /<tool_call>([\s\S]*?)<\/tool_call>/g;
  let blockMatch;
  let callIndex = 0;

  while ((blockMatch = blockRegex.exec(reasoning)) !== null) {
    const block = blockMatch[1].trim();

    // Try JSON format first: {"name":"...","arguments":{...}}
    const jsonMatch = block.match(/\{[\s\S]*"name"\s*:[\s\S]*"arguments"\s*:[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.name) {
          toolCalls.push({
            id: "call_reasoning_" + callIndex + "_" + Date.now(),
            type: "function",
            function: {
              name: parsed.name,
              arguments: typeof parsed.arguments === "string"
                ? parsed.arguments
                : JSON.stringify(parsed.arguments),
            },
          });
          callIndex++;
          continue;
        }
      } catch (_) { /* fall through to XML parser */ }
    }

    // XML format: <function=NAME><parameter=KEY>VALUE</parameter></function>
    const fnMatch = block.match(/<function=(\w+)>/);
    if (!fnMatch) continue;

    const fnName = fnMatch[1];
    const args = {};

    const paramRegex = /<parameter=(\w+)>\s*([\s\S]*?)\s*<\/parameter>/g;
    let paramMatch;
    while ((paramMatch = paramRegex.exec(block)) !== null) {
      const key = paramMatch[1];
      let value = paramMatch[2].trim();

      // Try parsing as number or boolean, fall back to string
      if (value === "true") value = true;
      else if (value === "false") value = false;
      else if (/^-?\d+(\.\d+)?$/.test(value)) value = Number(value);

      args[key] = value;
    }

    toolCalls.push({
      id: "call_reasoning_" + callIndex + "_" + Date.now(),
      type: "function",
      function: {
        name: fnName,
        arguments: JSON.stringify(args),
      },
    });
    callIndex++;
  }

  return toolCalls;
}

/**
 * Send a non-streaming chat completion request to LM Studio.
 * Used for tool-calling mode (stream: false for reliable tool_call parsing).
 *
 * @param {object[]} messages - Array of OpenAI-format messages
 * @param {object[]} [tools] - Array of tool definitions
 * @param {object} [config]
 * @param {string} [config.baseUrl] - LM Studio base URL
 * @param {string} [config.model] - Model name
 * @param {number} [config.maxTokens]
 * @param {number} [config.temperature]
 * @returns {Promise<object>} The chat completion response
 */
export async function sendMessage(messages, tools, config = {}) {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;

  const body = {
    model,
    messages,
    max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: config.temperature ?? 0.7,
    stream: false,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error("LM Studio API error " + response.status + ": " + errorText);
  }

  const json = await response.json();

  // Normalize: some models (qwen) put tool calls in reasoning_content
  // instead of the tool_calls array. Extract them so the agent loop works.
  normalizeReasoningToolCalls(json);

  return json;
}

/**
 * Stream a chat completion from LM Studio.
 * Yields delta chunks for real-time display.
 *
 * @param {object[]} messages - Array of OpenAI-format messages
 * @param {object[]} [tools] - Array of tool definitions
 * @param {object} [config]
 * @param {string} [config.baseUrl]
 * @param {string} [config.model]
 * @param {number} [config.maxTokens]
 * @param {number} [config.temperature]
 * @param {AbortSignal} [config.signal]
 * @returns {AsyncGenerator<object>} Yields {delta, finishReason, toolCalls}
 */
export async function* streamMessage(messages, tools, config = {}) {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;

  const body = {
    model,
    messages,
    max_tokens: config.maxTokens ?? DEFAULT_MAX_TOKENS,
    temperature: config.temperature ?? 0.7,
    stream: true,
  };

  if (tools && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  const response = await fetch(baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: config.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error("LM Studio API error " + response.status + ": " + errorText);
  }

  let toolCalls = [];
  let finishReason = null;
  let fullReasoning = "";  // Accumulated reasoning_content for tool-call extraction

  for await (const chunk of parseSSEStream(response.body, config.signal)) {
    const choice = chunk.choices?.[0];
    if (!choice) continue;

    finishReason = choice.finish_reason || finishReason;

    // Reasoning content — models like qwen emit chain-of-thought here
    const reasoningDelta = choice.delta?.reasoning_content;
    if (reasoningDelta) {
      fullReasoning += reasoningDelta;
      yield { type: "reasoning", content: reasoningDelta };
    }

    if (choice.delta?.tool_calls) {
      for (const tc of choice.delta.tool_calls) {
        const idx = tc.index;
        if (!toolCalls[idx]) {
          toolCalls[idx] = {
            id: tc.id || "",
            type: "function",
            function: { name: "", arguments: "" },
          };
        }
        if (tc.id) toolCalls[idx].id = tc.id;
        if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
      }
    }

    const delta = choice.delta?.content;
    if (delta) {
      yield { type: "delta", content: delta };
    }
  }

  // Models like qwen emit tool calls inside reasoning_content as <tool_call> XML
  // blocks instead of using the OpenAI tool_calls array. Parse them here so the
  // agent loop sees them as proper tool calls.
  if (toolCalls.length === 0 && fullReasoning.includes("<tool_call>")) {
    const extracted = parseToolCallsFromReasoning(fullReasoning);
    if (extracted.length > 0) {
      toolCalls = extracted;
    }
  }

  if (toolCalls.length > 0) {
    yield { type: "tool_calls", toolCalls };
  }

  yield { type: "done", finishReason };
}

/**
 * Build the messages array for an agent turn: system prompt + snapshot text + user message + history.
 *
 * @param {object} opts
 * @param {string} opts.userMessage - The user's latest message
 * @param {object[]} opts.history - Previous messages (user/assistant/tool)
 * @param {string} [opts.snapshotText] - Accessibility snapshot text from browser_snapshot
 * @param {boolean} [opts.toolMode=false] - Whether interaction tools are available
 * @param {string} [opts.systemPrompt]
 * @param {string} [opts.pageUrl] - The URL of the current page
 * @returns {object[]} OpenAI messages array
 */
export function buildMessages(opts) {
  const { userMessage, history = [], snapshotText, systemPrompt, toolMode = false, pageUrl } = opts;

  const messages = [
    { role: "system", content: buildSystemPrompt({ customPrompt: systemPrompt, toolMode }) },
  ];

  // Include prior conversation history
  for (const msg of history) {
    messages.push(msg);
  }

  // Build the latest user message — include page URL, snapshot, and user text
  const contentParts = [];

  // Always tell the LLM what page the user is on
  if (pageUrl) {
    contentParts.push({ type: "text", text: "[Current page URL: " + pageUrl + "]" });
  }

  // Accessibility snapshot as text context
  if (snapshotText) {
    contentParts.push({ type: "text", text: snapshotText });
  }

  // User message (last, so it's freshest in context)
  contentParts.push({ type: "text", text: userMessage });

  messages.push({ role: "user", content: contentParts });

  return messages;
}

export { DEFAULT_BASE_URL, DEFAULT_MODEL, DEFAULT_MAX_TOKENS };
