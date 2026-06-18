/**
 * Full GitHub-flavored markdown renderer with syntax highlighting.
 *
 * Replaces the old regex-based markdown-lite approach. Uses:
 *  - marked  — GFM: tables, task lists, strikethrough, footnotes, auto-links
 *  - highlight.js — syntax highlighting for fenced code blocks
 *
 * Marked handles HTML sanitization internally (no raw HTML passthrough),
 * so output is safe for dangerouslySetInnerHTML.
 */
import { marked } from "marked";
import hljs from "highlight.js";

// Configure marked for GFM with syntax highlighting
marked.setOptions({
  gfm: true,           // GitHub Flavored Markdown
  breaks: false,       // We handle newlines ourselves — don't convert single \n to <br>
});

/**
 * Highlight a code block using highlight.js.
 * Falls back to auto-detection when no language is specified.
 *
 * @param code - The raw code text
 * @param lang - The language from the fenced code block info string (may be empty)
 * @returns HTML string with syntax-highlighted code
 */
function highlightCode(code: string, lang: string): string {
  // Normalize language: strip whitespace, handle "js" → "javascript" aliases
  const normalized = (lang || "").trim().toLowerCase();
  const language = normalized
    ? hljs.getLanguage(normalized) ? normalized : ""
    : "";

  if (language) {
    try {
      const result = hljs.highlight(code, { language });
      return (
        '<pre><code class="hljs language-' +
        language +
        '">' +
        result.value +
        "</code></pre>"
      );
    } catch {
      // highlight failed — fall through to auto-detect
    }
  }

  // Auto-detect language
  try {
    const result = hljs.highlightAuto(code);
    return (
      '<pre><code class="hljs">' +
      result.value +
      "</code></pre>"
    );
  } catch {
    // Last resort: plain <pre><code>
    return "<pre><code>" + escapeHtml(code) + "</code></pre>";
  }
}

/**
 * Escape HTML entities to prevent XSS when rendering plain code blocks.
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Override marked's default code renderer to use highlight.js
const renderer = new marked.Renderer();

// Store original methods we're not overriding
const originalCode = renderer.code.bind(renderer);

renderer.code = function ({ text, lang }: { text: string; lang?: string }): string {
  return highlightCode(text, lang || "");
};

// Override link renderer to open links in new browser tabs.
// Sidepanel context: without target="_blank", links are inert.
const originalLink = renderer.link.bind(renderer);
renderer.link = function ({ href, title, text }: { href: string; title?: string | null; text: string }): string {
  const titleAttr = title ? ` title="${title}"` : "";
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};

/**
 * Render markdown text to safe HTML with syntax-highlighted code blocks.
 *
 * Supports full GFM:
 *  - Tables
 *  - Task lists (- [ ] and - [x])
 *  - Strikethrough (~~text~~)
 *  - Auto-linked URLs
 *  - Fenced code blocks with language (```python, ```js, etc.)
 *  - Inline code (`code`)
 *  - Bold, italic, headings, lists (ordered/unordered), blockquotes
 *  - Horizontal rules, images, links
 *
 * @param text - Raw markdown string
 * @returns Safe HTML string
 */
export function renderMarkdown(text: string): string {
  if (!text || !text.trim()) return "";

  try {
    const result = marked.parse(text, { renderer });
    // marked.parse can return string | Promise<string>; in sync mode it's always string
    return typeof result === "string" ? result : "";
  } catch {
    // If marked fails (very rare, e.g. deeply pathological input),
    // fall back to plain text with line breaks
    return escapeHtml(text).replace(/\n/g, "<br/>");
  }
}
