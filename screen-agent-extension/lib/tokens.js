/**
 * Token counting utilities for the Screen Agent extension.
 *
 * Uses gpt-tokenizer (the fastest pure-JS GPT tokenizer, trusted by Microsoft Teams)
 * for accurate token counts on chat message arrays. This module wraps it with helpers
 * for context-window awareness and compaction decisions.
 *
 * Why gpt-tokenizer and not a heuristic:
 *   - 4 chars ≈ 1 token is inaccurate for code/JSON/CJK text
 *   - gpt-tokenizer is a JS port of OpenAI's tiktoken — exact match for API behavior
 *   - It handles the chat message format internally, accounting for role tags and
 *     special tokens that raw text counting would miss
 *   - Works synchronously in browser/extension contexts with no WASM or native deps
 */

/**
 * Import from the encoding subpath — cl100k_base is the universal encoding
 * used by GPT-4, GPT-3.5, and most open models fine-tuned from them.
 * For o200k_base (GPT-4o, o1) use 'gpt-tokenizer/encoding/o200k_base'.
 * For o200k_harmony (gpt-oss-abliterated) use 'gpt-tokenizer/encoding/o200k_harmony'.
 */
import { countTokens } from "gpt-tokenizer/encoding/cl100k_base";

/**
 * Default context window size in tokens.
 * User can override in settings. 262144 is common for modern open models.
 */
export const DEFAULT_CONTEXT_WINDOW = 262144;

/**
 * Fraction of the context window at which we trigger conversation compaction.
 * 0.7 means compact when used tokens exceed 70% of the window.
 */
export const COMPACTION_THRESHOLD = 0.7;

/**
 * Count the exact number of tokens in an OpenAI-format messages array.
 *
 * Accepts the full messages array (system prompt + history + current message
 * with all tool calls and tool results). gpt-tokenizer's countTokens handles
 * the message structure — roles, names, content parts — natively.
 *
 * @param {object[]} messages - OpenAI-format chat messages array
 * @returns {number} Exact token count
 */
export function estimateTokens(messages) {
  if (!messages || messages.length === 0) return 0;
  try {
    return countTokens(messages);
  } catch {
    // If gpt-tokenizer fails on an edge case, fall back to a conservative
    // rough estimate: 3 chars ≈ 1 token (conservative over-estimate for English).
    // This only fires for malformed content that tiktoken can't handle.
    let total = 0;
    for (const msg of messages) {
      if (typeof msg.content === "string") {
        total += Math.ceil(msg.content.length / 3);
      } else if (Array.isArray(msg.content)) {
        for (const part of msg.content) {
          if (part.text) total += Math.ceil(part.text.length / 3);
        }
      }
      // Account for role/metadata overhead: ~4 tokens per message
      total += 4;
    }
    return total;
  }
}

/**
 * Check whether the conversation is full enough to warrant compaction.
 *
 * @param {object[]} messages - Full messages array being sent to the LLM
 * @param {number} contextWindow - The model's total context window in tokens
 * @param {number} [threshold=COMPACTION_THRESHOLD] - Fraction (0-1) at which to compact
 * @returns {{ shouldCompact: boolean, usage: { used: number, total: number, percent: number } }}
 */
export function checkContextUsage(messages, contextWindow, threshold = COMPACTION_THRESHOLD) {
  const used = estimateTokens(messages);
  const total = contextWindow || DEFAULT_CONTEXT_WINDOW;
  const percent = total > 0 ? Math.round((used / total) * 100) : 0;
  return {
    shouldCompact: used > total * threshold,
    usage: { used, total, percent },
  };
}
