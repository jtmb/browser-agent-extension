/**
 * Message types shared between background.js and the React side panel.
 *
 * Messages flow through chrome.runtime.sendMessage:
 *   side panel → background: { type: "agent_chat", userMessage, history }
 *   background → side panel: { type: "agent_response" | "agent_tool_call" | ... }
 */

export type MessageRole = "user" | "assistant" | "tool" | "system";

export interface HistoryMessage {
  role: MessageRole;
  content: string | Array<{ type: string; text?: string; image_url?: { url: string } }>;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
}

/** A rendered message in the chat UI */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  /** Plain text to display (tool calls / results are specially rendered) */
  content: string;
  /** If this message is a tool call */
  toolCall?: { name: string; args: string };
  /** If this message is a tool result */
  toolResult?: { name: string; success: boolean; summary?: string };
  /** If this message is an error */
  isError?: boolean;
  /** If this message is a warning */
  isWarning?: boolean;
  /** If this message is a progress update */
  isProgress?: boolean;
  /** Reasoning / chain-of-thought text (collapsible, streamed word-by-word) */
  reasoning?: string;
  /** Whether the reasoning block has been finalized (stops the streaming animation) */
  reasoningDone?: boolean;
  timestamp: number;
}

/** The active color theme */
export type ThemeMode = "dark" | "light";

export interface AgentSettings {
  baseUrl: string;
  model: string;
  /** Maximum tokens the LLM can output per response. Increase for long outputs like CSV exports. */
  maxTokens: number;
  /** The model's total context window size (tokens). Used for the context usage gauge and compaction. */
  contextWindow: number;
  /** When true, the agent gets full interaction tools (click, type, scroll, etc).
   *  When false, only observe/read tools are available — agent describes, never acts. */
  toolMode: boolean;
  /** When true, web_search spawns a sub-agent LLM call to synthesize results.
   *  When false, raw search results are returned directly to the main agent. */
  subAgents: boolean;
  /** List of enabled tool names. Empty array = all tools enabled (default).
   *  In describe-only mode, only observe tools plus those in this list are allowed. */
  enabledTools: string[];
  /** Active custom system prompt text. Empty string = use default. */
  systemPrompt: string;
  /** Name of the active profile (for display). Empty if using default or unsaved custom. */
  activeProfileName: string;
}

/** A named, saved system prompt profile */
export interface SystemPromptProfile {
  id: string;
  name: string;
  content: string;
}
