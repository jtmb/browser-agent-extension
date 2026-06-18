/**
 * fetch_webpage tool for the Screen Agent.
 *
 * Fetches a URL and extracts the full text content of the page.
 * Uses the fetch API — no debugger attach needed, works on any URL.
 *
 * Unlike web_search (which queries DuckDuckGo), this tool fetches a
 * specific page and returns its innerText. It's the right tool for:
 *   - Scraping a product page for prices/details
 *   - Reading article/documentation content
 *   - Extracting data from a known URL
 *
 * The fetched text is truncated to avoid blowing up the context window.
 */

/** Maximum characters of text to return to the LLM.
 *  With a default 262K token context window, 200K chars ≈ 50K tokens ≈ 19% usage.
 *  The conversation compaction system will handle edge cases with smaller models.
 *  This is intentionally high — VS Code's fetch_webpage has no limit at all.
 *  If you're hitting context overflow, reduce this or increase your model's context. */
const MAX_TEXT_LENGTH = 200000;

/**
 * Fetch a webpage and extract its visible text content.
 *
 * Strategy: fetch the HTML, then strip tags and scripts to get the
 * text content. This avoids requiring chrome.debugger access and works
 * on any URL the extension has host permissions for.
 *
 * @param {string} url - The URL to fetch
 * @returns {Promise<object>} { success, title, text, textLength, url }
 */
export async function executeFetchWebpage(url) {
  if (!url || typeof url !== "string") {
    return { success: false, error: "No URL provided" };
  }

  // Normalize URL — add https:// if missing
  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = "https://" + normalizedUrl;
  }

  let html;
  try {
    const response = await fetch(normalizedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status} ${response.statusText}` };
    }
    html = await response.text();
  } catch (err) {
    return { success: false, error: `Fetch failed: ${err.message}` };
  }

  if (!html) {
    return { success: false, error: "Empty response body" };
  }

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : "(no title)";

  // Strip scripts, styles, and non-content elements
  let text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "")   // Strip navigation
    .replace(/<footer[^>]*>[\s\S]*?<\/footer>/gi, "") // Strip footer
    .replace(/<header[^>]*>[\s\S]*?<\/header>/gi, ""); // Strip header

  // Replace block-level elements with newlines to preserve structure
  // (helps LLM see product cards, paragraphs, list items as separate lines)
  text = text
    .replace(/<\/(div|section|article|p|h[1-6]|li|tr|br)[^>]*>/gi, "\n")
    .replace(/<br[^>]*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ") // Strip remaining tags
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Collapse whitespace — but preserve newlines as line breaks
  text = text
    .replace(/[ \t]+/g, " ")           // Collapse horizontal whitespace
    .replace(/\n{3,}/g, "\n\n")        // Max 2 consecutive newlines
    .replace(/ \n/g, "\n")             // Strip trailing space before newline
    .replace(/\n /g, "\n")             // Strip leading space after newline
    .replace(/^\s+|\s+$/g, "")         // Trim
    // Remove empty lines and common boilerplate lines
    .split("\n")
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .filter(line => !/^(Skip to|Keyboard shortcuts|To move between|Interest-Based Ads|Notice|Continue Shopping)/i.test(line))
    .join("\n");

  const totalLength = text.length;
  const truncated = text.length > MAX_TEXT_LENGTH;

  if (truncated) {
    text = text.slice(0, MAX_TEXT_LENGTH);
    // Try to cut at a paragraph boundary (double newline), then single newline, then word boundary
    const paraBreak = text.lastIndexOf("\n\n");
    const lineBreak = text.lastIndexOf("\n");
    const wordBreak = text.lastIndexOf(" ");
    if (paraBreak > MAX_TEXT_LENGTH * 0.7) {
      text = text.slice(0, paraBreak);
    } else if (lineBreak > MAX_TEXT_LENGTH * 0.8) {
      text = text.slice(0, lineBreak);
    } else if (wordBreak > MAX_TEXT_LENGTH * 0.8) {
      text = text.slice(0, wordBreak);
    }
  }

  return {
    success: true,
    title,
    text,
    textLength: totalLength,
    truncated,
    url: normalizedUrl,
    summary: `Fetched "${title}" — ${totalLength.toLocaleString()} chars${truncated ? " (showing first " + text.length.toLocaleString() + " — extract what you can from this portion)" : ""}`,
  };
}
