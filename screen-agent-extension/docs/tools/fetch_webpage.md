# fetch_webpage

**What it does:** Fetches and extracts the full text content of a specific web page URL via HTTP. This is the **first choice** for scraping pages at URLs the user is NOT currently viewing. Uses `fetch()` — no debugger attach needed, works on any URL.

**WARNING:** Gets raw server HTML only — JavaScript-rendered content (React, Vue, SPA) is invisible. For the page the user is CURRENTLY looking at, use `read_page` instead (it reads the live DOM).

## Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | `string` | Yes | The full URL to fetch (e.g. `"https://example.com/page"`) |

## Return Shape

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether the fetch succeeded |
| `title` | `string` | Page title from `<title>` tag |
| `text` | `string` | Extracted visible text content |
| `textLength` | `number` | Character count of the full text (before truncation) |
| `url` | `string` | The fetched URL (normalized) |
| `truncated` | `boolean?` | Present if text was truncated at `MAX_TEXT_LENGTH` |
| `error` | `string` | Error message if `success` is false |

## APIs Used

- **`fetch()`** — Standard Web API with desktop User-Agent header

## Edge Cases

- **Missing protocol**: URLs without `http://` or `https://` are auto-prepended with `https://`
- **HTTP errors**: Non-2xx responses return `{ success: false, error: "HTTP 404 Not Found" }`
- **Empty response**: Returns `{ success: false, error: "Empty response body" }`
- **Network errors**: Caught and returned as `"Fetch failed: <message>"`
- **Anti-bot protection**: May return empty/junk text — the LLM is instructed to try `evaluate_js` on the current page instead
- **Large pages**: Text longer than `MAX_TEXT_LENGTH` (200,000 chars) is truncated at paragraph boundaries

## HTML Processing Pipeline

1. Fetch with desktop Chrome User-Agent
2. Strip non-content elements: `<script>`, `<style>`, `<noscript>`, `<svg>`, `<nav>`, `<footer>`, `<header>`
3. Replace block-level closing tags with newlines: `</div>`, `</section>`, `</article>`, `</p>`, `</h1>`–`</h6>`, `</li>`, `</tr>`, `<br>`
4. Strip remaining HTML tags
5. Decode HTML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&#39;`, `&nbsp;`)
6. Collapse whitespace: max 2 consecutive newlines, strip horizontal whitespace
7. Filter boilerplate lines (e.g. "Skip to", "Keyboard shortcuts")

## Truncation Strategy

When text exceeds 200,000 characters:
1. Try to cut at a **paragraph boundary** (double newline) if within the last 30%
2. Try **line boundary** (single newline) if within the last 20%
3. Fall back to **word boundary** (space)
4. If no good boundary, cut at exact limit

## Special Behavior

- Uses a **desktop Chrome User-Agent** string to avoid mobile-optimized or simplified responses
- The `MAX_TEXT_LENGTH` of 200,000 chars ≈ 50K tokens ≈ 19% of default 262K context window
- Designed to be the first scraping choice — the LLM's tool description says: "FIRST CHOICE for scraping pages at URLs the user is NOT currently viewing"
