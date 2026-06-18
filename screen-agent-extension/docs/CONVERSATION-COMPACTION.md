# Conversation Compaction

When the conversation history exceeds 70% of the context window, Screen Agent automatically summarizes older messages to stay within limits without losing context.

## When it triggers

- Token count > `COMPACTION_THRESHOLD` (70%) of `contextWindow`
- Checked before every message sent to the LLM

## What happens

1. `checkContextUsage()` in `lib/tokens.js` detects overflow
2. `compactConversation()` in `lib/compaction.js`:
   - Finds the last 2 user exchanges (preserves recent context)
   - Extracts all older messages
   - Sends older messages to the LLM with a summarization prompt
   - Replaces old messages with a single compacted summary
3. The agent continues with the compacted history

## Summarization prompt

The LLM is asked to preserve:
- **File paths** and their contents
- **URLs** and sources
- **Key facts** and decisions made
- **Tool call results** and their outcomes
- **Errors** encountered and how they were resolved

Format: `"[CONVERSATION SO FAR]\n<summary>\n... [END SUMMARY]\n<last N exchanges preserved>"`

## Configuration

| Setting | Default | Range |
|---------|---------|-------|
| Context Window Size | 262,144 | 4,096–1,048,576 |
| Compaction Threshold | 70% | Fixed |

## Code location

- `lib/compaction.js` — `compactConversation()`, `findExchangeBoundaries()`, `summarizeMessages()`
- `lib/tokens.js` — `checkContextUsage()` (triggers compaction)
- `background.js` — Agent loop checks and applies compaction before each LLM call
