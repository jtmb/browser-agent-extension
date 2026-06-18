/**
 * Structured logger for the Screen Agent extension.
 *
 * Chrome extension service workers cannot write to disk (no Node.js `fs`),
 * so this logger POSTs structured JSON entries to a local Node.js log server
 * (log-server.js). If the server is unreachable, it falls back to console.log
 * so nothing is lost.
 *
 * Usage:
 *   import { log } from "./lib/logger.js";
 *   log("info", "click executed", { x: 100, y: 200, element: "a" });
 *
 * Log levels: debug, info, warn, error
 */

const LOG_SERVER = "http://127.0.0.1:9999/log";

/** @type {string[]} Log buffer for entries that couldn't be sent (retried on next log) */
let pending = [];

/**
 * Send a single log entry to the log server. Falls back to console if
 * the server is unreachable.
 *
 * @param {"debug"|"info"|"warn"|"error"} level
 * @param {string} message
 * @param {*} [data] - Optional data payload (serialized to JSON)
 */
export async function log(level, message, data) {
  const entry = {
    level,
    message,
    data: data !== undefined ? data : undefined,
    timestamp: new Date().toISOString(),
  };

  // Flush any pending entries first (they may have been queued while server was down)
  if (pending.length > 0) {
    await flushPending();
  }

  try {
    await sendEntry(entry);
  } catch {
    // Server not running — queue for later and console-fallback
    pending.push(entry);
    consoleFallback(entry);
  }
}

/**
 * Attempt to flush the pending buffer to the log server.
 */
async function flushPending() {
  const batch = [...pending];
  pending = [];
  for (const entry of batch) {
    try {
      await sendEntry(entry);
    } catch {
      // Still can't reach server, put back
      pending.push(entry);
      break;
    }
  }
}

/**
 * POST a single entry to the log server.
 *
 * @param {object} entry
 */
async function sendEntry(entry) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const response = await fetch(LOG_SERVER, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Log server returned ${response.status}`);
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Fallback: print to console with timestamp and level.
 *
 * @param {object} entry
 */
function consoleFallback(entry) {
  const prefix = `[${entry.timestamp.slice(11, 23)}] [${entry.level.toUpperCase()}]`;
  const consoleFn =
    entry.level === "error"
      ? console.error
      : entry.level === "warn"
        ? console.warn
        : console.log;
  consoleFn(prefix, entry.message, entry.data !== undefined ? entry.data : "");
}
