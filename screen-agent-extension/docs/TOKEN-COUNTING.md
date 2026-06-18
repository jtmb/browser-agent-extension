# Token Counting & Context Window

Screen Agent uses `gpt-tokenizer` (a pure-JS port of OpenAI's tiktoken) for accurate token counting, not character-count heuristics.

## Token Encoding

- **Encoding**: `cl100k_base` (same as GPT-4 / GPT-3.5-turbo)
- **Package**: `gpt-tokenizer` v3.4.0 — no WASM, no native deps
- **Bundling**: Chrome MV3 service workers cannot import from `node_modules` directly. `esbuild` bundles `background.js` (including `gpt-tokenizer`) into `background.bundle.js` during `npm run build`.
- **Fallback**: If `countTokens()` throws, falls back to `~3 chars per token`

## Key Functions (`lib/tokens.js`)

### `estimateTokens(messages)`

Takes an array of OpenAI-format chat messages and returns the exact token count.

```js
import { estimateTokens } from "./tokens.js";
const count = estimateTokens([{ role: "user", content: "Hello" }]);
```

### `checkContextUsage(messages, contextWindow, threshold=0.7)`

Returns `{ shouldCompact, usage: { used, total, percent } }`.  
When `percent` exceeds `threshold` (default 70%), `shouldCompact` is `true`.

## Constants

| Constant | Value | Purpose |
|----------|-------|---------|
| `DEFAULT_CONTEXT_WINDOW` | 262,144 | Default context window (tokens) |
| `COMPACTION_THRESHOLD` | 0.7 (70%) | Trigger compaction at this usage |

## Settings

Users can configure:

- **Max Output Tokens** (256–131,072): Limits each LLM response. Different from context window.
- **Context Window Size** (4,096–1,048,576): Your model's maximum context. Used for the gauge and auto-compaction.
