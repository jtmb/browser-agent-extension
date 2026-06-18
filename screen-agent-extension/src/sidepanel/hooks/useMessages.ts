/**
 * Hook that manages message state, agent settings, and available LM Studio models.
 *
 * Messages from background.js:
 *   agent_response  → assistant text
 *   agent_tool_call → tool invocation banner
 *   agent_tool_result → tool result
 *   agent_error     → error message
 *   agent_warning   → warning
 *   agent_progress  → progress indicator
 *   agent_done      → marks turn complete
 */
import { useState, useCallback, useEffect, useRef } from "react";
import type { ChatMessage, HistoryMessage, AgentSettings, SystemPromptProfile } from "../types";

let nextId = 1;

const DEFAULT_SETTINGS: AgentSettings = {
  baseUrl: "http://127.0.0.1:1234/v1",
  model: "qwen/qwen3.5-9b",
  maxTokens: 16384,
  contextWindow: 262144,
  toolMode: false,
  subAgents: false,
  enabledTools: [],
  systemPrompt: "",
  activeProfileName: "",
};

export function useMessages() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [settings, setSettings] = useState<AgentSettings>(DEFAULT_SETTINGS);
  const [models, setModels] = useState<string[]>([]);
  const [prompts, setPrompts] = useState<SystemPromptProfile[]>([]);
  /** Current context window usage: { used, total, percent } for the circular gauge */
  const [contextUsage, setContextUsage] = useState<{ used: number; total: number; percent: number }>({ used: 0, total: 0, percent: 0 });
  /** List of saved file names from chrome.storage.local (for clickable references in chat) */
  const [fileNames, setFileNames] = useState<string[]>([]);
  const historyRef = useRef<HistoryMessage[]>([]);
  const lastToolCallIdRef = useRef<string>("");
  const bottomRef = useRef<HTMLDivElement>(null);

  // Listen for messages from background.js
  useEffect(() => {
    const handler = (msg: Record<string, unknown>) => {
      switch (msg.type) {
        case "agent_response":
          addMsg({ role: "assistant", content: String(msg.content || "") });
          // Coalesce streaming chunks into a single history entry
          {
            const last = historyRef.current[historyRef.current.length - 1];
            if (last && last.role === "assistant" && typeof last.content === "string") {
              last.content += String(msg.content || "");
            } else {
              historyRef.current.push({ role: "assistant", content: String(msg.content || "") });
            }
          }
          break;
        case "agent_tool_call":
          addMsg({
            role: "assistant",
            content: "",
            toolCall: { name: String(msg.tool || ""), args: String(msg.args || "") },
          });
          // Record tool call in history so the LLM doesn't repeat it on the next turn
          {
            const tcId = "hist_" + Date.now();
            lastToolCallIdRef.current = tcId;
            try {
              const parsedArgs = JSON.parse(String(msg.args || "{}"));
              historyRef.current.push({
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: tcId,
                  type: "function",
                  function: { name: String(msg.tool || ""), arguments: JSON.stringify(parsedArgs) },
                }],
              });
            } catch {
              historyRef.current.push({
                role: "assistant",
                content: null,
                tool_calls: [{
                  id: tcId,
                  type: "function",
                  function: { name: String(msg.tool || ""), arguments: String(msg.args || "{}") },
                }],
              });
            }
          }
          break;
        case "agent_tool_result":
          addMsg({
            role: "tool",
            content: "",
            toolResult: {
              name: String(msg.tool || ""),
              success: Boolean((msg.result as Record<string, unknown>)?.success),
              summary: String((msg.result as Record<string, unknown>)?.summary || ""),
            },
          });
          // Record tool result in history so the LLM has the full conversation state
          {
            const toolName = String(msg.tool || "");
            const resultObj = msg.result as Record<string, unknown>;
            const toolResultContent = toolName === "web_search" && resultObj?.displayText
              ? String(resultObj.displayText)
              : JSON.stringify(resultObj);
            historyRef.current.push({
              role: "tool",
              tool_call_id: lastToolCallIdRef.current || "hist_" + Date.now(),
              content: toolResultContent,
            });
          }
          break;
        case "agent_error":
          addMsg({ role: "system", content: String(msg.error || "Unknown error"), isError: true });
          setLoading(false);
          break;
        case "agent_warning":
          addMsg({ role: "system", content: String(msg.warning || ""), isWarning: true });
          break;
        case "agent_progress":
          addMsg({ role: "system", content: String(msg.stage || "...") + "...", isProgress: true });
          break;
        case "agent_done":
          setLoading(false);
          break;
        case "agent_reasoning_start":
          // Collapse reasoning across rounds within the SAME turn.
          // Only reset a reasoning block that appeared after the last user
          // message — don't touch reasoning from previous turns.
          setMessages((prev) => {
            const updated = [...prev];
            // Find the index of the last user message
            let lastUserIdx = -1;
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].role === "user") {
                lastUserIdx = i;
                break;
              }
            }
            // Look for a completed reasoning block after the last user msg
            for (let i = updated.length - 1; i > lastUserIdx; i--) {
              if (updated[i].reasoning !== undefined && updated[i].reasoningDone) {
                // Reset it — append separator and clear done flag
                updated[i] = { ...updated[i], reasoning: (updated[i].reasoning || "") + "\n", reasoningDone: false };
                return updated;
              }
            }
            // No existing reasoning in this turn — create a new one
            return [...updated, { id: String(++nextId), timestamp: Date.now(), role: "assistant", content: "", reasoning: "", reasoningDone: false }];
          });
          break;
        case "agent_reasoning":
          // Append reasoning text to the last message that has a reasoning field
          setMessages((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].reasoning !== undefined && !updated[i].reasoningDone) {
                updated[i] = { ...updated[i], reasoning: (updated[i].reasoning || "") + String(msg.content || "") };
                break;
              }
            }
            return updated;
          });
          break;
        case "agent_reasoning_end":
          // Mark the reasoning block as done (stops the streaming cursor animation)
          setMessages((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              if (updated[i].reasoning !== undefined && !updated[i].reasoningDone) {
                updated[i] = { ...updated[i], reasoningDone: true };
                break;
              }
            }
            return updated;
          });
          break;
        case "agent_context":
          // Update the circular context gauge in the chat window
          setContextUsage({
            used: Number(msg.usedTokens) || 0,
            total: Number(msg.contextWindow) || 0,
            percent: Number(msg.contextWindow) > 0
              ? Math.round(((Number(msg.usedTokens) || 0) / Number(msg.contextWindow)) * 100)
              : 0,
          });
          break;
        case "get_settings":
          if (msg.settings) setSettings(msg.settings as AgentSettings);
          break;
        case "get_profiles":
          if (msg.profiles) setPrompts(msg.profiles as SystemPromptProfile[]);
          break;
      }
    };

    if (typeof chrome !== "undefined" && chrome.runtime?.onMessage) {
      chrome.runtime.onMessage.addListener(handler);
      return () => chrome.runtime.onMessage.removeListener(handler);
    }
  }, []);

  // Load settings and file list on mount
  useEffect(() => {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "get_settings" });
      chrome.runtime.sendMessage({ type: "get_profiles" });
    }
    // Load saved file names for clickable references in chat
    if (typeof chrome !== "undefined" && chrome.storage?.local) {
      chrome.storage.local.get("agent_files").then((stored) => {
        const files = stored?.agent_files || {};
        setFileNames(Object.keys(files).sort());
      }).catch(() => {});
    }
    // Listen for file changes from write_file / delete_file
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      const onStorageChange = (changes: Record<string, chrome.storage.StorageChange>) => {
        if (changes["agent_files"]) {
          const files = changes["agent_files"].newValue || {};
          setFileNames(Object.keys(files).sort());
        }
      };
      chrome.storage.onChanged.addListener(onStorageChange);
      return () => chrome.storage.onChanged.removeListener(onStorageChange);
    }
  }, []);

  /**
   * Fetch the list of available models from LM Studio's /v1/models endpoint.
   * Uses the current baseUrl from settings.
   * When auto-switching models (current not in list), also fetches the
   * new model's max_context_length to update the context window.
   */
  const fetchModels = useCallback(async () => {
    try {
      const url = settings.baseUrl.replace(/\/+$/, "") + "/models";
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) return;
      const data = await res.json();
      const list: string[] = (data?.data || []).map((m: { id: string }) => m.id);
      setModels(list);
      // If current model isn't in the list, default to first available
      // and try to look up its context window
      if (list.length > 0 && !list.includes(settings.model)) {
        const newModel = list[0];
        setSettings((prev) => ({ ...prev, model: newModel }));
        // Fetch model details for context window
        try {
          const infoUrl = settings.baseUrl.replace(/\/+$/, "") + "/api/v0/models/" + encodeURIComponent(newModel);
          const infoRes = await fetch(infoUrl, { signal: AbortSignal.timeout(3000) });
          if (infoRes.ok) {
            const info = await infoRes.json();
            if (info?.max_context_length && info.max_context_length > 0) {
              setSettings((prev) => ({ ...prev, contextWindow: info.max_context_length }));
            }
          }
        } catch {
          // Silently ignore — user can set context window manually
        }
      }
    } catch {
      // LM Studio not running — that's fine, models stay as-is
    }
  }, [settings.baseUrl, settings.model]);

  // Fetch models on mount and when endpoint changes
  useEffect(() => {
    fetchModels();
  }, [fetchModels]);

  /** Persist settings to chrome.storage and update local state */
  const updateSettings = useCallback(
    async (newSettings: AgentSettings) => {
      setSettings(newSettings);
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "save_settings", settings: newSettings });
      }
    },
    []
  );

  /** Toggle tool mode on/off */
  const toggleToolMode = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, toolMode: !prev.toolMode };
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "save_settings", settings: next });
      }
      return next;
    });
  }, []);

  /** Toggle sub-agents on/off */
  const toggleSubAgents = useCallback(() => {
    setSettings((prev) => {
      const next = { ...prev, subAgents: !prev.subAgents };
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "save_settings", settings: next });
      }
      return next;
    });
  }, []);

  const addMsg = useCallback((partial: Omit<ChatMessage, "id" | "timestamp">) => {
    setMessages((prev) => {
      const last = prev[prev.length - 1];
      // If the last message is from the same role and we're streaming, append
      if (last && last.role === partial.role && partial.role === "assistant" && !partial.toolCall && !partial.toolResult) {
        return [
          ...prev.slice(0, -1),
          { ...last, content: last.content + partial.content },
        ];
      }
      // Replace last progress message
      if (last?.isProgress && partial.isProgress) {
        return [...prev.slice(0, -1), { id: String(nextId++), timestamp: Date.now(), ...partial }];
      }
      return [...prev, { id: String(nextId++), timestamp: Date.now(), ...partial }];
    });
  }, []);

  /** Send a user message to the background agent */
  const sendMessage = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      setLoading(true);

      // Record in history ref for future turns
      historyRef.current.push({ role: "user", content: text });

      addMsg({ role: "user", content: text });

      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({
          type: "agent_chat",
          userMessage: text,
          history: historyRef.current.slice(0, -1), // Send prior history, not the current message
          settings,
        });
      }
    },
    [addMsg, settings]
  );

  /** Cancel the current agent turn */
  const cancel = useCallback(() => {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "cancel" });
    }
    setLoading(false);
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    historyRef.current = [];
  }, []);

  /** Load saved profiles from storage */
  const fetchProfiles = useCallback(() => {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "get_profiles" }, (res: Record<string, unknown>) => {
        if (res?.profiles) setPrompts(res.profiles as SystemPromptProfile[]);
      });
    }
  }, []);

  /** Save a new or updated profile */
  const saveProfile = useCallback(
    (name: string, content: string, existingId?: string) => {
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        const profile: SystemPromptProfile = {
          id: existingId || "prf_" + Date.now(),
          name: name.trim(),
          content: content.trim(),
        };
        chrome.runtime.sendMessage({ type: "save_profile", profile }, (res: Record<string, unknown>) => {
          if (res?.profiles) setPrompts(res.profiles as SystemPromptProfile[]);
        });
      }
    },
    []
  );

  /** Delete a profile by id */
  const deleteProfile = useCallback((id: string) => {
    if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
      chrome.runtime.sendMessage({ type: "delete_profile", profileId: id }, (res: Record<string, unknown>) => {
        if (res?.profiles) setPrompts(res.profiles as SystemPromptProfile[]);
      });
    }
  }, []);

  /** Select a profile — loads its content into settings.systemPrompt */
  const selectProfile = useCallback(
    (profileId: string) => {
      const profile = prompts.find((p) => p.id === profileId);
      if (!profile) return;
      const updated = {
        ...settings,
        systemPrompt: profile.content,
        activeProfileName: profile.name,
      };
      setSettings(updated);
      if (typeof chrome !== "undefined" && chrome.runtime?.sendMessage) {
        chrome.runtime.sendMessage({ type: "save_settings", settings: updated });
      }
    },
    [settings, prompts]
  );

  return { messages, loading, settings, models, prompts, contextUsage, fileNames, sendMessage, cancel, clear, updateSettings, toggleToolMode, toggleSubAgents, fetchModels, fetchProfiles, saveProfile, deleteProfile, selectProfile, bottomRef };
}
