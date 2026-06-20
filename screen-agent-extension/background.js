/**
 * Background Service Worker for the Screen Agent extension.
 *
 * Responsibilities:
 * - Route messages between the Side Panel, external control page, and the active tab
 * - Attach chrome.debugger to the active tab and use CDP Accessibility.getFullAXTree
 *   for page snapshots (same tree Playwright uses internally)
 * - Run the agent turn loop: user message + page snapshot → LM Studio → tool calls → repeat
 * - Tool dispatch: CDP browser tools via executeCdpTool(), local tools via executeLocalTool()
 * - Structured logging to local file via log-server.js HTTP endpoint
 * - Direct action API via externally_connectable for testing without LLM
 *
 * Architecture:
 *   Side Panel  ←→  chrome.runtime.sendMessage  ←→  background.js  ←→  LM Studio (fetch)
 *   Control Page ←→  chrome.runtime.connect      ←→                    ←→  Log Server (POST)
 *                                                                         ←→  Browser Tab (CDP)
 */

import { buildMessages, streamMessage, buildSystemPrompt, DEFAULT_BASE_URL, DEFAULT_MODEL } from "./lib/lmstudio.js";
import { executeFileTool, toNumber, executeCdpTool, getCdpToolDefinitions, clearBufferedEvents, pushConsoleMessage, pushNetworkRequest } from "./tools/definitions.js";
import { executeWebSearch } from "./tools/web_search.js";
import { executeFetchWebpage } from "./tools/fetch_webpage.js";
import { executeDownloadFile } from "./tools/download_file.js";
import { log } from "./lib/logger.js";
import { estimateTokens, checkContextUsage, DEFAULT_CONTEXT_WINDOW } from "./lib/tokens.js";
import { compactConversation } from "./lib/compaction.js";
import { LOCAL_TOOL_NAMES, getLocalToolDefinitions } from "./lib/mcp-tools.js";

// ── State ──────────────────────────────────────────────────────────────────

/** Agent run state */
let activeAbortController = null;

/** Track which tab has the side panel open. Used to toggle open/close. */
let sidePanelOpenForTabId = null;

/** The tab that currently has the debugger attached (CDP session) */
let activeDebuggee = null;

// ── Action Icon Click — Toggle Side Panel ─────────────────────────────────

chrome.action.onClicked.addListener(async (tab) => {
  if (sidePanelOpenForTabId === tab.id) {
    // Side panel is open — tell it to close, then clear tracking
    chrome.runtime.sendMessage({ type: "close_side_panel" }).catch(() => {});
    sidePanelOpenForTabId = null;
  } else {
    // Side panel is closed — open it
    await chrome.sidePanel.open({ tabId: tab.id });
    sidePanelOpenForTabId = tab.id;
  }
});

// ── Side Panel Communication ──────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  log("debug", "onMessage received", { type: message.type, source: sender?.id });
  (async () => {
    try {
    switch (message.type) {
      case "agent_chat":
        await handleAgentChat(message, sender, sendResponse);
        break;
      case "get_settings":
        await handleGetSettings(sendResponse);
        break;
      case "save_settings":
        await handleSaveSettings(message.settings, sendResponse);
        break;
      case "get_profiles":
        await handleGetProfiles(sendResponse);
        break;
      case "save_profile":
        await handleSaveProfile(message.profile, sendResponse);
        break;
      case "delete_profile":
        await handleDeleteProfile(message.profileId, sendResponse);
        break;
      case "cancel":
        handleCancel(sendResponse);
        break;
      case "side_panel_closed":
        sidePanelOpenForTabId = null;
        break;
      default:
        sendResponse({ error: "Unknown message type: " + message.type });
    }
    } catch (err) {
      log("error", "onMessage handler crashed", { error: err?.message, stack: err?.stack, type: message.type });
      try { sendResponse({ error: "Internal error: " + err?.message }); } catch {}
    }
  })();
  return true;
});

// ── External Connection (Control Page API) ─────────────────────────────────

chrome.runtime.onConnectExternal.addListener((port) => {
  log("info", "External control page connected", { name: port.name });

  port.onMessage.addListener(async (msg) => {
    log("info", "External action received", { action: msg.action, args: msg });

    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (!activeTab) {
        port.postMessage({ ok: false, error: "No active tab" });
        return;
      }

      // Ensure debugger is attached for CDP browser tools
      if (!activeDebuggee || activeDebuggee.tabId !== activeTab.id) {
        await attachToTab(activeTab.id);
      }

      try {
        const debuggee = { tabId: activeTab.id };

        if (msg.action === "snapshot" || msg.action === "get_elements") {
          const result = await executeCdpTool("browser_snapshot", {}, debuggee);
          port.postMessage({ ok: true, text: result.text, summary: result.summary });
        } else if (msg.action === "screenshot") {
          const result = await executeCdpTool("browser_take_screenshot", {}, debuggee);
          port.postMessage({ ok: true, text: result.text, summary: result.summary });
        } else if (msg.action === "evaluate") {
          const result = await executeCdpTool("browser_evaluate", { function: msg.expression || "document.title" }, debuggee);
          port.postMessage({ ok: true, ...result });
        } else if (msg.action === "click" || msg.action === "type" || msg.action === "press_key" ||
                   msg.action === "hover" || msg.action === "navigate" || msg.action === "wait") {
          const toolMap = {
            click: "browser_click", type: "browser_type", press_key: "browser_press_key",
            hover: "browser_hover", navigate: "browser_navigate", wait: "browser_wait_for"
          };
          const cdpName = toolMap[msg.action] || msg.action;
          const args = { ...msg };
          delete args.action;
          if (msg.action === "click" && args.index !== undefined) {
            args.ref = String(args.index);
            delete args.index;
          }
          if (msg.action === "wait" && args.ms !== undefined) {
            args.time = args.ms;
            delete args.ms;
          }
          const result = await executeCdpTool(cdpName, args, debuggee);
          port.postMessage({ ok: true, ...result });
        } else {
          port.postMessage({ ok: false, error: "Unknown action: " + msg.action });
        }
      } catch (err) {
        log("error", "External action failed", { error: err.message });
        port.postMessage({ ok: false, error: err.message });
      }
    } catch (err) {
      log("error", "External action failed", { error: err.message });
      port.postMessage({ ok: false, error: err.message });
    }
  });

  port.onDisconnect.addListener(() => {
    log("info", "External control page disconnected");
  });
});

// ── Settings ───────────────────────────────────────────────────────────────

async function handleGetSettings(sendResponse) {
  const defaults = { baseUrl: DEFAULT_BASE_URL, model: DEFAULT_MODEL, maxTokens: 16384, contextWindow: DEFAULT_CONTEXT_WINDOW, systemPrompt: "", activeProfileName: "", toolMode: false, subAgents: false, enabledTools: [] };
  const stored = await chrome.storage.local.get("settings");
  sendResponse({ settings: { ...defaults, ...(stored.settings || {}) } });
}

async function handleSaveSettings(settings, sendResponse) {
  await chrome.storage.local.set({ settings });
  sendResponse({ success: true });
}

/** Get all saved system prompt profiles */
async function handleGetProfiles(sendResponse) {
  const stored = await chrome.storage.local.get("system_prompts");
  sendResponse({ profiles: stored.system_prompts || [] });
}

/** Save or update a system prompt profile */
async function handleSaveProfile(profile, sendResponse) {
  const stored = await chrome.storage.local.get("system_prompts");
  const profiles = stored.system_prompts || [];
  const idx = profiles.findIndex((p) => p.id === profile.id);
  if (idx >= 0) {
    profiles[idx] = profile;
  } else {
    profiles.push(profile);
  }
  await chrome.storage.local.set({ system_prompts: profiles });
  sendResponse({ success: true, profiles });
}

/** Delete a system prompt profile by id */
async function handleDeleteProfile(profileId, sendResponse) {
  const stored = await chrome.storage.local.get("system_prompts");
  const profiles = (stored.system_prompts || []).filter((p) => p.id !== profileId);
  await chrome.storage.local.set({ system_prompts: profiles });
  sendResponse({ success: true, profiles });
}

function handleCancel(sendResponse) {
  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
    sendResponse({ success: true, message: "Cancelled" });
  } else {
    sendResponse({ success: false, message: "No active agent turn" });
  }
}

// ── Debugger Lifecycle ─────────────────────────────────────────────────────

/**
 * Attach chrome.debugger to a tab, enable CDP domains, and start buffering events.
 * Only one debugger attachment is active at a time.
 *
 * @param {number} tabId - The Chrome tab ID to attach to
 * @returns {Promise<object>} The debuggee object { tabId }
 */
async function attachToTab(tabId) {
  // Already attached to this tab — skip re-attach, just clear stale buffers
  if (activeDebuggee && activeDebuggee.tabId === tabId) {
    clearBufferedEvents();
    log("info", "Debugger already attached to tab", { tabId });
    return { tabId };
  }

  // Detach from previous tab if switching tabs
  if (activeDebuggee && activeDebuggee.tabId !== tabId) {
    try { await chrome.debugger.detach(activeDebuggee); } catch {}
  }

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    activeDebuggee = { tabId };

    // Enable CDP domains for console/network/profiling
    await chrome.debugger.sendCommand({ tabId }, "Runtime.enable", {});
    await chrome.debugger.sendCommand({ tabId }, "Network.enable", {});
    await chrome.debugger.sendCommand({ tabId }, "Log.enable", {});
    await chrome.debugger.sendCommand({ tabId }, "Page.enable", {});

    // Clear any stale buffered events from previous turns
    clearBufferedEvents();

    log("info", "Debugger attached", { tabId });
  } catch (err) {
    log("error", "Debugger attach failed", { tabId, error: err.message });
    throw new Error(`Failed to attach debugger to tab ${tabId}: ${err.message}`);
  }

  return { tabId };
}

/**
 * Detach the debugger from the currently attached tab.
 * Safe to call even if not attached.
 */
async function detachFromTab() {
  if (activeDebuggee) {
    try { await chrome.debugger.detach(activeDebuggee); } catch {}
    activeDebuggee = null;
    log("info", "Debugger detached");
  }
}

// ── Debugger Event Listener (buffered console/network events) ──────────────

chrome.debugger.onEvent.addListener((source, method, params) => {
  // Only buffer events for the actively attached tab
  if (activeDebuggee && source.tabId !== activeDebuggee.tabId) return;

  if (method === "Runtime.consoleAPICalled") {
    // Normalize into a common shape
    pushConsoleMessage({
      type: params.type || "log",
      text: params.args?.map((a) => a.value ?? a.description).join(" ") || "",
      args: params.args,
      timestamp: params.timestamp,
    });
  } else if (method === "Log.entryAdded") {
    pushConsoleMessage({
      type: params.entry?.level || "log",
      text: params.entry?.text || "",
      timestamp: params.entry?.timestamp,
    });
  } else if (method === "Network.requestWillBeSent") {
    pushNetworkRequest(params);
  }
});

// ── Agent Turn Loop ────────────────────────────────────────────────────────

/**
 * Run one agent turn: snapshot page, send to LM Studio, execute tool calls, repeat.
 *
 * @param {object} message - { userMessage, history, settings }
 * @param {object} sender
 * @param {function} sendResponse
 */
async function handleAgentChat(message, sender, sendResponse) {
  if (activeAbortController) {
    activeAbortController.abort();
  }
  activeAbortController = new AbortController();
  const signal = activeAbortController.signal;

  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!activeTab) {
      sendResponse({ error: "No active tab found" });
      return;
    }

    log("info", "Agent turn started", { userMessage: message.userMessage, tabId: activeTab.id, tabUrl: activeTab.url });

    sendResponse({ status: "started", tabId: activeTab.id });

    const pageUrl = activeTab.url || "";

    // ── Load settings ──
    const storedSettings = await chrome.storage.local.get("settings");
    const stored = storedSettings.settings || {};
    const settings = {
      baseUrl: DEFAULT_BASE_URL,
      model: DEFAULT_MODEL,
      toolMode: false,
      subAgents: false,
      enabledTools: [],
      ...stored,
      ...(message.settings || {})
    };

    // ── Tool definitions: build once per turn ──
    const localToolDefs = getLocalToolDefinitions();
    const allToolDefs = [...getCdpToolDefinitions(), ...localToolDefs];
    const enabledSet = settings.enabledTools?.length
      ? new Set(settings.enabledTools)
      : new Set(allToolDefs.map((t) => t.function.name));

    // ── Attach debugger + capture snapshot ───────────────────────────
    let snapshotText = "";

    if (settings.toolMode) {
      try {
        chrome.runtime.sendMessage({ type: "agent_progress", stage: "Attaching debugger..." });

        await attachToTab(activeTab.id);
        const debuggee = { tabId: activeTab.id };

        chrome.runtime.sendMessage({ type: "agent_progress", stage: "Capturing accessibility tree..." });
        const snapResult = await executeCdpTool("browser_snapshot", {}, debuggee);
        snapshotText = snapResult.text || snapResult.summary || "";

        log("info", "Debugger attached + snapshot captured", {
          tabId: activeTab.id,
          localTools: LOCAL_TOOL_NAMES.size,
          cdpTools: getCdpToolDefinitions().length,
          snapshotLen: snapshotText.length,
        });
      } catch (attachErr) {
        log("error", "Debugger attach failed", { error: attachErr.message });
        chrome.runtime.sendMessage({
          type: "agent_error",
          error: "Could not attach debugger: " + attachErr.message + ". Ensure no other DevTools windows are open for this tab.",
        });
        return;
      }
    }

    // ── Filter tools ──────────────────────────────────────────────────
    // toolMode=true:  CDP browser tools + local tools, filtered by enabledTools
    // toolMode=false: Only local observation tools (web_search, file I/O)
    let tools;
    if (settings.toolMode) {
      tools = allToolDefs.filter((t) => enabledSet.has(t.function.name));
    } else {
      // Describe-only: local tools only
      const readOnlyNames = new Set([
        "web_search", "fetch_webpage", "download_file",
        "write_file", "read_file", "list_files", "delete_file"
      ]);
      tools = allToolDefs.filter((t) => readOnlyNames.has(t.function.name));
    }

    // ── Conversation compaction ───────────────────────────────────────
    let historyToUse = message.history || [];
    if (historyToUse.length > 0 && settings.contextWindow) {
      const tentative = buildMessages({
        userMessage: message.userMessage,
        history: historyToUse,
        snapshotText,
        toolMode: settings.toolMode,
        systemPrompt: settings.systemPrompt || "",
        pageUrl,
      });
      const { shouldCompact } = checkContextUsage(tentative, settings.contextWindow);
      if (shouldCompact) {
        log("info", "Compacting conversation");
        chrome.runtime.sendMessage({ type: "agent_progress", stage: "Compacting conversation" });
        try {
          historyToUse = await compactConversation(historyToUse, {
            baseUrl: settings.baseUrl,
            model: settings.model,
            contextWindow: settings.contextWindow,
          });
        } catch (compactErr) {
          log("warn", "Compaction failed", { error: compactErr.message });
          historyToUse = message.history || [];
        }
      }
    }

    let messages = buildMessages({
      userMessage: message.userMessage,
      history: historyToUse,
      snapshotText,
      toolMode: settings.toolMode,
      systemPrompt: settings.systemPrompt || "",
      pageUrl,
    });

    const allowedTools = new Set(tools.map((t) => t.function.name));

    // Send context usage to the sidepanel for the gauge
    const ctxUsage = settings.contextWindow
      ? checkContextUsage(messages, settings.contextWindow)
      : { usage: { used: 0, total: 0, percent: 0 } };
    chrome.runtime.sendMessage({
      type: "agent_context",
      usedTokens: ctxUsage.usage.used,
      contextWindow: ctxUsage.usage.total,
    });

    // ── Agent loop ────────────────────────────────────────────────────
    const MAX_TOOL_ROUNDS = 10;
    let webSearchUsedThisTurn = false;
    let roundStallCount = 0;
    let lastToolName = "";

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      if (signal.aborted) break;

      let fullContent = "";
      let fullReasoning = "";
      let streamingToolCalls = [];
      let finishReason = null;
      let reasoningStarted = false;

      try {
        const lastMsgs = messages.slice(-6).map((m, i) => {
          let content = m.content;
          if (typeof content === "string" && content.length > 200) content = content.slice(0, 200) + "...";
          if (Array.isArray(content)) content = `[${content.length} parts]`;
          return `  msg[${messages.length - 6 + i}]=${m.role} ${content}`;
        }).join("\n");

        log("debug", `LM Studio request round ${round}`, {
          totalMessages: messages.length,
          tools: tools.length,
          lastMessages: lastMsgs,
        });

        const stream = streamMessage(messages, tools, {
          baseUrl: settings.baseUrl,
          model: settings.model,
          maxTokens: settings.maxTokens,
          signal,
        });

        for await (const chunk of stream) {
          if (signal.aborted) break;

          if (chunk.type === "reasoning") {
            if (!reasoningStarted) {
              reasoningStarted = true;
              chrome.runtime.sendMessage({ type: "agent_reasoning_start" });
            }
            fullReasoning += chunk.content;
            chrome.runtime.sendMessage({ type: "agent_reasoning", content: chunk.content });
          } else if (chunk.type === "delta") {
            if (reasoningStarted) {
              chrome.runtime.sendMessage({ type: "agent_reasoning_end" });
              reasoningStarted = false;
            }
            fullContent += chunk.content;
            chrome.runtime.sendMessage({ type: "agent_response", content: chunk.content });
          } else if (chunk.type === "tool_calls") {
            streamingToolCalls = chunk.toolCalls;
          } else if (chunk.type === "done") {
            finishReason = chunk.finishReason;
          }
        }
      } catch (apiError) {
        if (reasoningStarted) {
          chrome.runtime.sendMessage({ type: "agent_reasoning_end" });
          reasoningStarted = false;
        }
        log("error", "LM Studio API call failed", { error: apiError.message, round });
        chrome.runtime.sendMessage({ type: "agent_error", error: "LM Studio error: " + apiError.message });
        break;
      }

      if (signal.aborted) break;

      if (reasoningStarted) {
        chrome.runtime.sendMessage({ type: "agent_reasoning_end" });
        reasoningStarted = false;
      }

      // ── Execute tool calls ──────────────────────────────────────────
      if (streamingToolCalls.length > 0) {
        log("info", "LLM called tools", {
          round,
          toolCount: streamingToolCalls.length,
          tools: streamingToolCalls.map((tc) => tc.function.name),
        });

        messages.push({
          role: "assistant",
          content: fullContent || null,
          tool_calls: streamingToolCalls,
        });

        for (const toolCall of streamingToolCalls) {
          if (signal.aborted) break;

          const toolName = toolCall.function.name;
          lastToolName = toolName;

          // Reject disallowed tools
          if (!allowedTools.has(toolName)) {
            log("warn", "LLM called disallowed tool", { tool: toolName });
            chrome.runtime.sendMessage({
              type: "agent_warning",
              warning: "Tool \"" + toolName + "\" is not available.",
            });
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({ success: false, error: "Tool \"" + toolName + "\" is not available." }),
            });
            continue;
          }

          // Prevent web_search loops
          if (toolName === "web_search" && webSearchUsedThisTurn) {
            log("warn", "LLM attempted duplicate web_search");
            messages.push({
              role: "tool",
              tool_call_id: toolCall.id,
              content: JSON.stringify({
                success: false,
                error: "You already searched once this turn. Answer with the results you have.",
              }),
            });
            continue;
          }

          chrome.runtime.sendMessage({
            type: "agent_tool_call",
            tool: toolName,
            args: toolCall.function.arguments,
          });

          let result;

          try {
            if (LOCAL_TOOL_NAMES.has(toolName)) {
              // ── Local tools ──────────────────────────────────────────
              result = await executeLocalTool(toolName, toolCall.function.arguments, settings, signal);
              if (toolName === "web_search") webSearchUsedThisTurn = true;
            } else {
              // ── CDP browser tools ────────────────────────────────────
              let args;
              try {
                args = typeof toolCall.function.arguments === "string"
                  ? JSON.parse(toolCall.function.arguments)
                  : toolCall.function.arguments;
              } catch {
                args = {};
              }

              const debuggee = { tabId: activeTab.id };
              const cdpResult = await executeCdpTool(toolName, args, debuggee);

              // If the tool returns a snapshot (after navigation/click), use it as new page state
              if (cdpResult.text && (toolName === "browser_snapshot" || toolName === "browser_navigate" ||
                  toolName === "browser_navigate_back" || toolName === "browser_click" ||
                  toolName === "browser_type" || toolName === "browser_hover" ||
                  toolName === "browser_wait_for" || toolName === "browser_drag" ||
                  toolName === "browser_press_key")) {
                snapshotText = cdpResult.text;
              }

              result = {
                success: cdpResult.success,
                summary: cdpResult.summary || ("Executed " + toolName),
                displayText: cdpResult.displayText || cdpResult.text || cdpResult.summary,
              };

              // For snapshots, send as user message so the model sees the raw tree
              if (toolName === "browser_snapshot" && cdpResult.text) {
                messages.push({
                  role: "tool",
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(result),
                });
                messages.push({
                  role: "user",
                  content: cdpResult.text,
                });
                continue;
              }
            }
          } catch (toolError) {
            result = { success: false, error: toolError.message };
            log("error", "Tool execution failed", { tool: toolName, error: toolError.message });
          }

          chrome.runtime.sendMessage({
            type: "agent_tool_result",
            tool: toolName,
            result,
          });

          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: JSON.stringify(result),
          });
        }

        continue;
      }

      // ── No tool calls — model is done ───────────────────────────────
      log("info", "LLM text response (no tools)", {
        contentLen: fullContent.length,
        reasoningLen: fullReasoning.length,
      });

      if (finishReason === "length") {
        chrome.runtime.sendMessage({ type: "agent_warning", warning: "Response was truncated." });
      }

      const visibleContent = (fullContent && fullContent.trim()) || (fullReasoning && fullReasoning.trim()) || "";

      if (!visibleContent) {
        roundStallCount++;
        if (roundStallCount > 3) {
          log("error", "Model unresponsive after 3 rounds");
          chrome.runtime.sendMessage({ type: "agent_done" });
          break;
        }
        log("warn", "Empty response — retrying", { roundStallCount, lastTool: lastToolName });
        messages.push({ role: "user", content: "Continue." });
        continue;
      }

      roundStallCount = 0;
      messages.push({ role: "assistant", content: visibleContent });
      break;
    }

    log("info", "Agent turn complete");
    chrome.runtime.sendMessage({ type: "agent_done" });
  } catch (err) {
    if (!signal.aborted) {
      log("error", "Agent turn failed", { error: err.message, stack: err.stack });
      chrome.runtime.sendMessage({ type: "agent_error", error: err.message });
    }
  } finally {
    activeAbortController = null;
    // Keep debugger attached for subsequent turns — detach only on tab close
  }
}

// ── Local Tool Execution ──────────────────────────────────────────────────

/**
 * Execute a local-only tool (web_search, fetch_webpage, download_file, file I/O).
 *
 * @param {string} toolName
 * @param {string} rawArgs - JSON string of arguments from the LLM
 * @param {object} settings - Current settings (baseUrl, model, subAgents)
 * @param {AbortSignal} signal
 * @returns {Promise<object>} Result object with { success, summary?, displayText?, ... }
 */
async function executeLocalTool(toolName, rawArgs, settings, signal) {
  let args;
  try {
    args = typeof rawArgs === "string" ? JSON.parse(rawArgs) : rawArgs;
  } catch {
    args = {};
  }

  switch (toolName) {
    case "web_search": {
      const query = (args.query || "").trim();
      if (!query) return { success: false, error: "No search query provided" };

      const result = await executeWebSearch(query, {
        useSubAgent: settings.subAgents === true,
        baseUrl: settings.baseUrl,
        model: settings.model,
      });
      log("info", "Web search executed", { query: query.slice(0, 60) });

      if (result.success && result.shortSynthesis) {
        let text = `[Web search: ${query}]\n\n${result.shortSynthesis}`;
        if (result.results && result.results.length > 0) {
          text += "\n\nSources:\n";
          for (const r of result.results) {
            if (r.url) text += `- ${r.title || r.url} ${r.url}\n`;
          }
        }
        result.displayText = text;
      } else if (result.success && result.results && result.results.length > 0) {
        const lines = result.results.map((r, i) => {
          const label = r.title || r.url;
          return r.url ? `${i + 1}. **${label}** [link](${r.url})` : `${i + 1}. ${r.snippet}`;
        });
        result.displayText = `[Web search: ${query}]\n\n${lines.join('\n')}`;
      }
      return result;
    }

    case "fetch_webpage": {
      const url = (args.url || "").trim();
      if (!url) return { success: false, error: "No URL provided" };

      const result = await executeFetchWebpage(url);
      log("info", "Webpage fetched", { url: url.slice(0, 80), success: result.success });

      if (result.success && result.text) {
        result.displayText = `[Fetched: ${url}]\n\n${result.text.slice(0, 4000)}`;
      } else if (!result.success) {
        result.displayText = `[Fetch URL: ${url}]\n\nError: ${result.error}`;
      }
      return result;
    }

    case "download_file": {
      const url = (args.url || "").trim();
      if (!url) return { success: false, error: "No URL provided" };

      const result = await executeDownloadFile(url, args.filename || undefined);
      log("info", "File download", { url: url.slice(0, 80), success: result.success });

      if (result.success) {
        result.displayText = `[Download] ${result.filename || url}`;
      }
      return result;
    }

    case "write_file":
    case "read_file":
    case "list_files":
    case "delete_file": {
      const toolCall = {
        id: "local_" + Date.now(),
        type: "function",
        function: { name: toolName, arguments: rawArgs },
      };
      return await executeFileTool(toolCall);
    }

    default:
      return { success: false, error: "Unknown local tool: " + toolName };
  }
}

// ── Extension Lifecycle ────────────────────────────────────────────────────

log("info", "Background service worker started");
