/**
 * Conversation compaction — summarizes old messages to stay within the
 * model's context window during long conversations.
 *
 * Strategy: when the message array exceeds 70% of the context window,
 * we take all messages before the last 2 user↔assistant exchanges and
 * ask the LLM to produce a dense summary. Those old messages are replaced
 * with a single system-level summary, preserving context window headroom.
 */

import { COMPACTION_THRESHOLD } from "./tokens.js";

/**
 * Compact a conversation by summarizing older messages.
 *
 * Keeps the most recent 2 user↔assistant exchanges intact (including any
 * tool calls and tool results within those exchanges). Everything before
 * that is sent to the LLM for summarization.
 *
 * @param {object[]} messages - Full conversation messages array
 * @param {object} settings - { baseUrl, model, contextWindow }
 * @returns {Promise<object[]>} Compacted messages array
 */
export async function compactConversation(messages, settings = {}) {
  const exchanges = findExchangeBoundaries(messages);

  // Need at least 3 user messages to make compaction worthwhile
  if (exchanges.length <= 2) return messages;

  // Split: last 2 exchanges stay intact, older ones get summarized
  const keepFrom = exchanges[exchanges.length - 2]; // Start of 2nd-to-last exchange
  const olderMessages = messages.slice(0, keepFrom);
  const recentMessages = messages.slice(keepFrom);

  // Generate a summary of the older conversation
  const summary = await summarizeMessages(olderMessages, settings);

  // Build compacted array: system summary + recent messages
  const compacted = [
    {
      role: "system",
      content: "[Conversation so far — key facts, decisions, and context preserved from earlier messages]\n\n" + summary,
    },
    ...recentMessages,
  ];

  return compacted;
}

/**
 * Find the indices where each user message starts in the conversation.
 * An "exchange" is a user message + all assistant/tool messages that follow
 * before the next user message.
 *
 * @param {object[]} messages - Full messages array
 * @returns {number[]} Array of indices where each user message appears
 */
function findExchangeBoundaries(messages) {
  const boundaries = [];
  for (let i = 0; i < messages.length; i++) {
    if (messages[i].role === "user") {
      boundaries.push(i);
    }
  }
  return boundaries;
}

/**
 * Send older messages to the LLM for summarization.
 *
 * Uses a dedicated system prompt that instructs the model to produce a
 * dense, factual summary preserving all important information.
 *
 * @param {object[]} olderMessages - Messages to summarize
 * @param {object} settings - { baseUrl, model }
 * @returns {Promise<string>} Summarized text
 */
async function summarizeMessages(olderMessages, settings = {}) {
  const baseUrl = settings.baseUrl || "http://127.0.0.1:1234/v1";
  const model = settings.model || "qwen/qwen3.5-9b";

  const summaryMessages = [
    {
      role: "system",
      content:
        "You are a conversation summarizer. Your ONLY job is to produce a concise summary of the conversation below. " +
        "Preserve ALL of the following — do NOT omit or generalize:\n" +
        "- Every file path, filename, URL, and command mentioned\n" +
        "- Every fact discovered, data retrieved, or search result\n" +
        "- Every tool call made and its outcome\n" +
        "- Every user request and whether it was completed\n" +
        "- Any errors encountered and how they were resolved\n\n" +
        "Write the summary as a bulleted list. Be dense and precise. Do NOT add commentary — just the facts.",
    },
    {
      role: "user",
      content:
        "Summarize the following conversation. Keep ALL important details — file paths, URLs, facts, tool results, errors, decisions:\n\n" +
        olderMessages
          .map((m) => {
            const role = m.role.toUpperCase();
            const content =
              typeof m.content === "string" ? m.content : JSON.stringify(m.content);
            // Truncate very long messages to avoid summary exceeding token budget
            const truncated = content.length > 2000 ? content.slice(0, 2000) + "…(truncated)" : content;
            return `[${role}] ${truncated}`;
          })
          .join("\n\n"),
    },
  ];

  try {
    const body = {
      model,
      messages: summaryMessages,
      max_tokens: 2048, // Summary should fit in 2K tokens
      temperature: 0.3, // Low temperature for factual accuracy
      stream: false,
    };

    const response = await fetch(baseUrl + "/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error("Summarization API error " + response.status);
    }

    const json = await response.json();
    const summary = json.choices?.[0]?.message?.content || "";
    return summary || "(Summary unavailable — continuing with recent conversation)";
  } catch (err) {
    // If summarization fails, return a minimal placeholder so the
    // conversation can continue — better than crashing the agent turn.
    return "(Automatic summary unavailable due to API error: " + (err.message || "unknown") + ". Recent conversation preserved below.)";
  }
}
