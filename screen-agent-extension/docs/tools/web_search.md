# web_search

**What it does:** Searches the web using DuckDuckGo's free Instant Answer API (no API key required). When sub-agents are enabled in settings, spawns a one-shot LLM call to synthesize search results into a concise answer.

## Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `query` | `string` | Yes | The search query — be specific, use keywords that return relevant results |

## Return Shape

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether the search succeeded |
| `summary` | `string` | e.g. `Found 7 result(s). Instant answer available.` |
| `abstract` | `string?` | DuckDuckGo instant answer text (if available) |
| `abstractUrl` | `string?` | URL for the instant answer |
| `results` | `array` | Up to 5 search results: `[{ title, url, snippet }]` |
| `shortSynthesis` | `string?` | If sub-agents enabled: LLM-synthesized answer (≤800 chars) |
| `error` | `string` | Error message if `success` is false |

## APIs Used

- **DuckDuckGo Instant Answer API** — `api.duckduckgo.com/?q=...&format=json&no_html=1&skip_disambig=1`
  - Free, no API key required
  - Returns: `AbstractText`, `AbstractURL`, `Heading`, `RelatedTopics`
- **DuckDuckGo HTML fallback** — `html.duckduckgo.com/html/?q=...`
  - Used when JSON API returns 0 results (rate-limiting or filtered queries)
  - Parses `result__a` links and `result__snippet` snippets

## LM Studio / LLM APIs Used (Sub-Agent)

- **`sendMessage`** from `lib/lmstudio.js` — One-shot non-streaming chat completion
  - `maxTokens: 512`, `temperature: 0.3`

## Edge Cases

- **Empty response from DDG**: JSON API returns empty body → throws `"DuckDuckGo API returned empty response (rate-limited or unreachable)"`
- **Non-JSON response**: DDG returns HTML error page → falls back to HTML scraper
- **0 results from JSON API**: Logs a warning and tries `scrapeDdgHtml()` HTML fallback
- **Nested Topics**: DDG `RelatedTopics` can contain nested `Topics` arrays (disambiguation) — recursively extracted
- **Rate limiting**: `AbortSignal.timeout(10000)` on JSON API, `6000ms` on HTML fallback
- **HTML fallback URL decoding**: DDG wraps URLs with `uddg=` param — extracted and decoded

## Fallback Logic

1. Try DuckDuckGo JSON API (primary)
2. If 0 results → try DuckDuckGo HTML scraping
3. If sub-agents enabled → synthesize with one-shot LLM call

## Special Behavior

- Results are capped at **10** from the JSON API and **5** returned to the LLM (to save context window)
- Sub-agent synthesis is capped at **800 characters** with `… (truncated)` marker
- Sub-agent prompt includes: "YOU MUST include the URL from the search results for every fact you mention"
- The `snippet` field from DDG uses the `" — "` separator to split title from description
