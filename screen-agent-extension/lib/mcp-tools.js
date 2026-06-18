/**
 * Local Tool Definitions
 *
 * These are the tools that always run inside the extension — no external
 * server or debugger attachment required. They include:
 *   - web_search (DuckDuckGo API)
 *   - fetch_webpage (HTTP fetch)
 *   - download_file (Chrome downloads API)
 *   - File I/O (chrome.storage.local)
 *
 * Browser interaction tools are CDP-backed and defined in tools/definitions.js.
 */

// ── Local Tool Definitions ────────────────────────────────────────────────

/**
 * Get the standard local tool definitions that always run inside the extension.
 *
 * @returns {object[]} OpenAI-formatted tool definitions for local tools
 */
export function getLocalToolDefinitions() {
  return [
    {
      type: "function",
      function: {
        name: "web_search",
        description:
          "Search the web for information using DuckDuckGo. " +
          "Use this when the user asks a question you don't know the answer to, " +
          "or when you need current information beyond your training data. " +
          "Returns search result titles, URLs, and snippets.",
        parameters: {
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query. Be specific — use keywords that would return relevant results.",
            },
          },
          required: ["query"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "fetch_webpage",
        description:
          "Fetch and extract the full text content of a specific web page URL via HTTP. " +
          "Use for scraping pages at URLs the user is NOT currently viewing. " +
          "WARNING: gets raw server HTML only — JavaScript-rendered content (React, Vue, SPA) is invisible. " +
          "For the page the user is CURRENTLY looking at, use browser_snapshot instead. " +
          "Returns the page title and up to 4,000 characters of visible text.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The full URL to fetch (e.g. 'https://example.com/page').",
            },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "download_file",
        description:
          "Download a file from a URL to the user's computer. " +
          "Use this for binary files (zip, PDF, exe, images) and release assets. " +
          "Triggers a browser download — the file saves to the user's default Downloads folder.",
        parameters: {
          type: "object",
          properties: {
            url: {
              type: "string",
              description: "The URL of the file to download.",
            },
            filename: {
              type: "string",
              description: "Optional: suggested filename. Extracted from URL if omitted.",
            },
          },
          required: ["url"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "write_file",
        description:
          "Write structured data to a persistent file. " +
          "Use this to save extraction results, analysis, generated code, " +
          "JSON, CSV, or markdown documents. Files persist across conversation turns.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "File name with extension (e.g. 'report.md', 'data.json').",
            },
            content: {
              type: "string",
              description: "The complete file content as a string.",
            },
          },
          required: ["name", "content"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "read_file",
        description:
          "Read a previously saved file by name. Use this to retrieve data " +
          "you stored earlier for analysis or follow-up.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The file name to read (e.g. 'report.md').",
            },
          },
          required: ["name"],
        },
      },
    },
    {
      type: "function",
      function: {
        name: "list_files",
        description:
          "List all saved files with their names and sizes. Use this to see " +
          "what data you have stored before reading files.",
        parameters: { type: "object", properties: {} },
      },
    },
    {
      type: "function",
      function: {
        name: "delete_file",
        description:
          "Delete a previously saved file by name.",
        parameters: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "The file name to delete.",
            },
          },
          required: ["name"],
        },
      },
    },
  ];
}

// ── Local Tool Name Set ───────────────────────────────────────────────────

/**
 * Set of tool names that are handled locally (not through CDP debugger).
 * Used by the agent loop to decide dispatch path.
 */
export const LOCAL_TOOL_NAMES = new Set([
  "web_search",
  "fetch_webpage",
  "download_file",
  "write_file",
  "read_file",
  "list_files",
  "delete_file",
]);
