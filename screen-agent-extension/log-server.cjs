/**
 * Log Server — receives structured logs from the Screen Agent extension.
 *
 * The Chrome extension service worker cannot write to disk, so it POSTs
 * JSON log entries to this tiny HTTP server. Each entry is appended as a
 * JSON line to agent.log in the extension directory.
 *
 * Usage:
 *   node log-server.js [port]
 *   tail -f agent.log
 *
 * API:
 *   POST /log  body: {"level":"info","message":"did thing","data":{...}}
 *   GET  /     returns last 50 log lines as HTML
 */

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = parseInt(process.argv[2], 10) || 9999;
const LOG_FILE = path.join(__dirname, "agent.log");

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Append a JSON line to the log file. Creates the file if it doesn't exist.
 *
 * @param {object} entry - { level, message, data, timestamp }
 */
function appendLog(entry) {
  const line = JSON.stringify(entry) + "\n";
  fs.appendFileSync(LOG_FILE, line, "utf8");
}

/**
 * Read the last N lines from the log file.
 *
 * @param {number} n
 * @returns {object[]}
 */
function readLastLines(n = 50) {
  try {
    const content = fs.readFileSync(LOG_FILE, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    return lines.slice(-n).map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { raw: l };
      }
    });
  } catch {
    return [];
  }
}

// ── Server ─────────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  // CORS headers — extension runs on chrome-extension:// origin
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === "POST" && req.url === "/log") {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      try {
        const entry = JSON.parse(body);
        // Ensure timestamp exists
        if (!entry.timestamp) entry.timestamp = new Date().toISOString();
        entry._receivedAt = new Date().toISOString();
        appendLog(entry);

        // Also print to server stdout so you can watch with `node log-server.js`
        const levelColor = { error: "\x1b[31m", warn: "\x1b[33m", info: "\x1b[36m", debug: "\x1b[90m" };
        const color = levelColor[entry.level] || "";
        const reset = "\x1b[0m";
        console.log(`${color}[${entry.level.toUpperCase()}]${reset} ${entry.message}`);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } catch (err) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON body" }));
      }
    });
    return;
  }

  if (req.method === "GET" && req.url === "/") {
    const lines = readLastLines(50);
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Screen Agent Logs</title>
<style>
  body { font-family: monospace; background: #1a1a2e; color: #e0e0e0; padding: 20px; }
  .entry { border-bottom: 1px solid #333; padding: 6px 0; }
  .ts { color: #666; margin-right: 10px; }
  .info { color: #4fc3f7; } .error { color: #ef5350; } .warn { color: #ffb74d; } .debug { color: #888; }
  .data { color: #a5d6a7; margin-left: 20px; font-size: 0.9em; }
</style></head><body>
<h2>Screen Agent Logs (last 50)</h2>
${lines.map((e) => {
  const raw = e.raw ? `<span class="entry"><span class="ts">-</span>${e.raw}</span>` : "";
  if (e.raw) return raw;
  return `<div class="entry">
    <span class="ts">${(e.timestamp || "").slice(11, 23)}</span>
    <span class="${e.level || "debug"}">[${(e.level || "?").toUpperCase()}]</span>
    ${e.message}
    ${e.data ? `<div class="data">${JSON.stringify(e.data, null, 2)}</div>` : ""}
  </div>`;
}).join("\n")}
</body></html>`;
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
    return;
  }

  // Health check
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ status: "ok", logFile: LOG_FILE, entries: readLastLines(0).length }));
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`[log-server] Listening on http://127.0.0.1:${PORT}`);
  console.log(`[log-server] Writing to ${LOG_FILE}`);
  console.log(`[log-server] Open http://127.0.0.1:${PORT}/ to view logs`);
  console.log(`[log-server] Or run: tail -f ${LOG_FILE}`);
});
