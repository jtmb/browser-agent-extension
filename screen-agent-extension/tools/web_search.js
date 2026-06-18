/**
 * Web search tool for the Screen Agent.
 *
 * Uses DuckDuckGo's free Instant Answer API (no API key required).
 * When sub-agents are enabled, spawns a one-shot LLM call to synthesize
 * search results into a concise, useful answer. When disabled, returns
 * raw structured search results.
 *
 * The DuckDuckGo API returns:
 *   - Abstract / AbstractText / AbstractURL — instant answer
 *   - RelatedTopics — list of { Text, FirstURL }
 *   - Heading — query heading
 *
 * Sub-agent synthesis: search results are sent to the same LM Studio
 * model with a one-shot prompt asking it to answer the user's query
 * based on the search results. This provides the same benefit as a
 * real sub-agent without the complexity of multi-turn tool use.
 */

import { sendMessage, DEFAULT_BASE_URL, DEFAULT_MODEL } from "../lib/lmstudio.js";

/** DuckDuckGo Instant Answer API endpoint */
const DDG_API = "https://api.duckduckgo.com/";

/**
 * Search DuckDuckGo for a query and return structured results.
 *
 * @param {string} query - The search query
 * @returns {Promise<object>} { query, abstract, abstractUrl, heading, results: [{title, url, snippet}] }
 */
export async function searchDuckDuckGo(query) {
  const url = DDG_API + "?q=" + encodeURIComponent(query) + "&format=json&no_html=1&skip_disambig=1";

  const response = await fetch(url, {
    headers: {
      "Accept": "application/json",
      "User-Agent": "ScreenAgent/1.0",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!response.ok) {
    throw new Error("DuckDuckGo API returned HTTP " + response.status);
  }

  // DuckDuckGo sometimes returns empty body on rate-limit or outage
  const text = await response.text();
  if (!text || !text.trim()) {
    throw new Error("DuckDuckGo API returned empty response (rate-limited or unreachable)");
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("DuckDuckGo API returned non-JSON response: " + text.slice(0, 100));
  }

  // Build structured results
  const results = [];

  // Instant answer (if any)
  if (data.AbstractText && data.AbstractText.trim()) {
    results.push({
      title: data.Heading || "Answer",
      url: data.AbstractURL || "",
      snippet: data.AbstractText,
    });
  }

  // Related topics
  const topics = data.RelatedTopics || [];
  for (const topic of topics) {
    // Some topics have nested "Topics" array (disambiguation categories)
    if (topic.Topics) {
      for (const subtopic of topic.Topics) {
        if (subtopic.Text && subtopic.FirstURL) {
          // DDG RelatedTopics Text format: "Title — Description" — extract title
          const dashIdx = subtopic.Text.indexOf(" - ");
          const title = dashIdx > 0 ? subtopic.Text.slice(0, dashIdx).trim() : "";
          results.push({
            title,
            url: subtopic.FirstURL,
            snippet: subtopic.Text,
          });
        }
      }
    } else if (topic.Text && topic.FirstURL) {
      const dashIdx = topic.Text.indexOf(" - ");
      const title = dashIdx > 0 ? topic.Text.slice(0, dashIdx).trim() : "";
      results.push({
        title,
        url: topic.FirstURL,
        snippet: topic.Text,
      });
    }
  }

  // Log empty results to help diagnose DuckDuckGo rate-limiting
  if (results.length === 0) {
    console.warn("DuckDuckGo JSON API returned 0 results for query:", query, " — trying HTML fallback");
    const fallbackResults = await scrapeDdgHtml(query);
    if (fallbackResults.length > 0) {
      console.log("HTML fallback yielded", fallbackResults.length, "results for query:", query);
      results.push(...fallbackResults);
    }
  }

  return {
    query,
    abstract: data.AbstractText || "",
    abstractUrl: data.AbstractURL || "",
    heading: data.Heading || "",
    results: results.slice(0, 10), // Limit to top 10 for context window
  };
}

/**
 * HTML fallback: scrape DuckDuckGo's non-JS HTML search page when the
 * Instant Answer JSON API returns 0 results. The HTML version does not
 * apply the same content filtering as the JSON API.
 *
 * Uses html.duckduckgo.com which serves a simple HTML page designed for
 * older browsers — easy to parse without a headless browser.
 *
 * @param {string} query - The search query
 * @returns {Promise<Array<{title: string, url: string, snippet: string}>>}
 */
async function scrapeDdgHtml(query) {
  const encoded = encodeURIComponent(query);
  const url = "https://html.duckduckgo.com/html/?q=" + encoded;

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
    });
    clearTimeout(timer);

    if (!response.ok) {
      console.error("[WebSearch] DDG HTML returned HTTP " + response.status);
      return [];
    }

    const html = await response.text();

    // DDG HTML results have this structure:
    //   <a rel="nofollow" class="result__a" href="URL">Title</a>
    //   <a class="result__snippet" href="URL">Snippet text</a>
    // URLs are wrapped through DDG's redirect with a uddg= param.

    // Parse result links with titles
    const linkRegex = /<a[^>]*class="result__a"[^>]*href="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    const links = [];
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      let href = match[1];
      // Extract real URL from DDG's redirect wrapper: uddg=URL
      const uddgMatch = href.match(/uddg=([^&]+)/);
      if (uddgMatch) {
        try { href = decodeURIComponent(uddgMatch[1]); } catch { href = uddgMatch[1]; }
      }
      links.push({
        title: match[2].replace(/<\/?[^>]+>/g, "").trim(),
        url: href,
      });
    }

    // Parse snippets
    const snippetRegex = /<a[^>]*class="result__snippet"[^>]*>(.+?)<\/a>/gi;
    const snippets = [];
    while ((match = snippetRegex.exec(html)) !== null) {
      snippets.push(match[1].replace(/<\/?[^>]+>/g, "").trim());
    }

    // Pair links with snippets by position. Return in the same shape
    // as the JSON API path: { title, url, snippet }.
    const results = [];
    for (let i = 0; i < Math.min(links.length, 10); i++) {
      results.push({
        title: links[i].title,
        url: links[i].url,
        snippet: snippets[i] || links[i].title,
      });
    }

    return results;
  } catch (err) {
    console.error("[WebSearch] DDG HTML fallback error:", err.message);
    return [];
  }
}

/**
 * Synthesize search results into a concise answer using the LLM as a sub-agent.
 *
 * Sends a one-shot (non-streaming) message to LM Studio asking it to read
 * the search results and answer the user's query.
 *
 * @param {string} query - The original search query
 * @param {object} searchData - The raw search results from searchDuckDuckGo
 * @param {object} config - { baseUrl, model } from settings
 * @returns {Promise<string>} The synthesized answer text
 */
export async function synthesizeWithSubAgent(query, searchData, config = {}) {
  const baseUrl = config.baseUrl || DEFAULT_BASE_URL;
  const model = config.model || DEFAULT_MODEL;

  // Build search results as text
  let resultsText = "SEARCH RESULTS FOR: \"" + searchData.query + "\"\n\n";

  if (searchData.abstract) {
    resultsText += "Instant Answer: " + searchData.abstract + "\n";
    if (searchData.abstractUrl) {
      resultsText += "Source: " + searchData.abstractUrl + "\n";
    }
    resultsText += "\n";
  }

  resultsText += "Web Results:\n";
  for (let i = 0; i < searchData.results.length; i++) {
    const r = searchData.results[i];
    resultsText += (i + 1) + ". ";
    if (r.title) resultsText += r.title + " — ";
    resultsText += r.snippet + "\n";
    if (r.url) resultsText += "   " + r.url + "\n";
  }

  const messages = [
    {
      role: "system",
      content: "You are a search result synthesizer. Read the search results below and answer the query. Keep it SHORT (3-5 sentences). YOU MUST include the URL from the search results for every fact you mention — like (https://...) after each sentence. Example: 'Dogs are domesticated wolves (https://en.wikipedia.org/wiki/Dog).' If results are empty say 'No results found.' Do NOT suggest further searches. Just answer.",
    },
    {
      role: "user",
      content: "Query: " + query + "\n\n" + resultsText + "\n\nAnswer in 2-4 sentences:",
    },
  ];

  const response = await sendMessage(messages, [], {
    baseUrl,
    model,
    maxTokens: 512, // Enough for synthesis + URLs
    temperature: 0.3, // Low temperature for factual accuracy
  });

  const content = response.choices?.[0]?.message?.content || "";
  return content.trim() || "(No synthesis produced)";
}

/**
 * Execute a web search and optionally synthesize with a sub-agent.
 *
 * This is the main entry point called by background.js when the LLM
 * invokes the web_search tool.
 *
 * @param {string} query - The search query
 * @param {object} config - { useSubAgent, baseUrl, model }
 * @returns {Promise<object>} { success, summary, results?, synthesis? }
 */
export async function executeWebSearch(query, config = {}) {
  const { useSubAgent = false, baseUrl, model } = config;

  try {
    const searchData = await searchDuckDuckGo(query);

    // Always include the result count
    let summary = "Found " + searchData.results.length + " result(s)";
    if (searchData.abstract) {
      summary += ". Instant answer available.";
    }

    if (useSubAgent) {
      // Synthesize with sub-agent LLM call
      const synthesis = await synthesizeWithSubAgent(query, searchData, { baseUrl, model });
      // Truncate synthesis to ~800 chars — long enough to include URLs.
      const shortSynthesis = synthesis.length > 800
        ? synthesis.slice(0, 800) + "… (truncated)"
        : synthesis;
      summary += " Synthesized by sub-agent.";
      // Also return raw results so the main LLM can extract URLs even if the
      // synthesis dropped them. The background.js formatter combines both.
      const shortResults = searchData.results.slice(0, 5);
      return {
        success: true,
        summary,
        shortSynthesis,
        abstract: searchData.abstract || undefined,
        abstractUrl: searchData.abstractUrl || undefined,
        results: shortResults,
      };
    }

    // No sub-agent — return raw results, also trimmed
    const shortResults = searchData.results.slice(0, 5);
    return {
      success: true,
      summary,
      abstract: searchData.abstract || undefined,
      abstractUrl: searchData.abstractUrl || undefined,
      results: shortResults,
    };
  } catch (err) {
    return {
      success: false,
      summary: "Search failed",
      error: err.message,
    };
  }
}
