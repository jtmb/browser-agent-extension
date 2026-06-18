/**
 * File viewer for agent-saved files stored in chrome.storage.local.
 *
 * Supports:
 *   - Raw text (default for .txt, .json, code files)
 *   - Table view for .csv files (auto-parsed)
 *   - Table view for .xlsx files (parsed via SheetJS)
 *   - Rendered markdown for .md files (via marked + highlight.js)
 *
 * Bundled with esbuild to include marked, highlight.js, and xlsx.
 */

import { marked } from "marked";
import hljs from "highlight.js";
import * as XLSX from "xlsx";

// ── marked config ────────────────────────────────────────────────────────────

marked.setOptions({ gfm: true, breaks: false });

const mdRenderer = new marked.Renderer();
mdRenderer.link = function ({ href, title, text }) {
  const t = title ? ' title="' + title + '"' : "";
  return '<a href="' + href + '"' + t + ' target="_blank" rel="noopener noreferrer">' + text + '</a>';
};
mdRenderer.code = function ({ text, lang }) {
  const language = lang && hljs.getLanguage(lang) ? lang : "";
  try {
    const r = language ? hljs.highlight(text, { language }) : hljs.highlightAuto(text);
    return '<pre><code class="hljs' + (language ? ' language-' + language : '') + '">' + r.value + '</code></pre>';
  } catch {
    return '<pre><code>' + escapeHtml(text) + '</code></pre>';
  }
};

const STORAGE_KEY = "agent_files";

let selectedFile = null;
let fileMap = {};
let viewMode = "raw";

// ── DOM refs ─────────────────────────────────────────────────────────────────

const $ = (id) => document.getElementById(id);
const fileList = $("file-list");
const fileCount = $("file-count");
const storageUsed = $("storage-used");
const refreshBtn = $("refresh-btn");
const placeholder = $("viewer-placeholder");
const contentPane = $("viewer-content");
const viewerFilename = $("viewer-filename");
const viewerSize = $("viewer-size");
const viewerModified = $("viewer-modified");
const viewerBody = $("viewer-body");
const copyBtn = $("copy-btn");
const deleteBtn = $("delete-btn");
const toggleBtn = $("view-toggle-btn");

// ── File loading ─────────────────────────────────────────────────────────────

async function loadFiles() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  fileMap = stored[STORAGE_KEY] || {};
  renderSidebar();
}

function renderSidebar() {
  const names = Object.keys(fileMap).sort();
  fileCount.textContent = String(names.length);
  if (names.length === 0) {
    fileList.innerHTML = '<li class="viewer-empty">No files saved yet</li>';
  } else {
    fileList.innerHTML = names.map((name) => {
      const f = fileMap[name];
      const active = name === selectedFile ? " active" : "";
      const size = f.content ? new Blob([f.content]).size : 0;
      const sizeStr = size < 1024 ? size + " B" : (size / 1024).toFixed(1) + " KB";
      return '<li class="viewer-file-item' + active + '" data-file="' + escapeAttr(name) + '">' +
        '<span class="viewer-file-icon">' + iconForFile(name) + '</span>' +
        '<span class="viewer-file-name">' + escapeHtml(name) + '</span>' +
        '<span class="viewer-file-size">' + sizeStr + '</span></li>';
    }).join("");
  }
  let totalBytes = 0;
  for (const f of Object.values(fileMap)) totalBytes += f.content ? new Blob([f.content]).size : 0;
  storageUsed.textContent = totalBytes < 1024 ? totalBytes + " B used" : totalBytes < 1048576 ? (totalBytes / 1024).toFixed(1) + " KB used" : (totalBytes / 1048576).toFixed(1) + " MB used";
}

function fileExt(name) { return (name || "").split(".").pop()?.toLowerCase() || ""; }

function defaultViewMode(name) {
  const ext = fileExt(name);
  if (ext === "csv" || ext === "xlsx" || ext === "xls") return "table";
  if (ext === "md") return "rendered";
  return "raw";
}

function availableModes(ext) {
  if (ext === "csv" || ext === "xlsx" || ext === "xls") return ["table", "raw"];
  if (ext === "md") return ["rendered", "raw"];
  return ["raw"];
}

// ── View file ────────────────────────────────────────────────────────────────

function viewFile(name) {
  const file = fileMap[name];
  if (!file) return;
  selectedFile = name;
  viewMode = defaultViewMode(name);
  placeholder.style.display = "none";
  contentPane.style.display = "flex";
  viewerFilename.textContent = name;
  const size = file.content ? new Blob([file.content]).size : 0;
  viewerSize.textContent = size < 1024 ? size + " B" : (size / 1024).toFixed(1) + " KB";
  viewerModified.textContent = "Modified: " + new Date(file.modified).toLocaleString();
  renderContent();
  updateToggleBtn();
  renderSidebar();
}

function renderContent() {
  if (!selectedFile || !fileMap[selectedFile]) return;
  const content = fileMap[selectedFile].content || "";
  const ext = fileExt(selectedFile);

  if (viewMode === "table" && (ext === "csv" || ext === "xlsx" || ext === "xls")) {
    viewerBody.className = "viewer-body viewer-body-table";
    viewerBody.innerHTML = ext === "csv" ? renderCSVTable(content) : renderXLSXTable(content);
  } else if (viewMode === "rendered" && ext === "md") {
    viewerBody.className = "viewer-body viewer-body-rendered";
    try { viewerBody.innerHTML = marked.parse(content, { renderer: mdRenderer }); }
    catch { viewerBody.textContent = content; }
  } else {
    viewerBody.className = "viewer-body";
    viewerBody.textContent = content;
  }
}

function toggleViewMode() {
  const ext = fileExt(selectedFile || "");
  const modes = availableModes(ext);
  const idx = modes.indexOf(viewMode);
  viewMode = modes[(idx + 1) % modes.length];
  renderContent();
  updateToggleBtn();
}

function updateToggleBtn() {
  if (!toggleBtn) return;
  const ext = fileExt(selectedFile || "");
  const modes = availableModes(ext);
  if (modes.length <= 1) { toggleBtn.style.display = "none"; return; }
  toggleBtn.style.display = "";
  const nextIdx = (modes.indexOf(viewMode) + 1) % modes.length;
  toggleBtn.textContent = modes[nextIdx] === "table" ? "Table View" : modes[nextIdx] === "rendered" ? "Rendered" : "Raw";
}

// ── CSV parser ───────────────────────────────────────────────────────────────

function renderCSVTable(csv) {
  if (!csv || !csv.trim()) return '<p class="viewer-empty">Empty file</p>';
  const rows = parseCSV(csv);
  if (rows.length === 0) return '<p class="viewer-empty">No data</p>';
  const headers = rows[0], dataRows = rows.slice(1);
  let html = '<div class="viewer-table-wrap"><table class="viewer-table"><thead><tr>';
  for (const h of headers) html += '<th>' + escapeHtml(h) + '</th>';
  html += '</tr></thead><tbody>';
  for (const row of dataRows) {
    html += '<tr>';
    for (let i = 0; i < headers.length; i++) html += '<td>' + escapeHtml(row[i] || "") + '</td>';
    html += '</tr>';
  }
  html += '</tbody></table></div>';
  html += '<p class="viewer-table-info">' + dataRows.length + ' rows × ' + headers.length + ' columns</p>';
  return html;
}

function parseCSV(text) {
  const rows = []; let row = [], field = "", inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i], nx = text[i + 1];
    if (inQ) {
      if (ch === '"' && nx === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ",") { row.push(field); field = ""; }
      else if (ch === "\n" || (ch === "\r" && nx === "\n")) {
        row.push(field); field = ""; if (row.length > 0) rows.push(row); row = [];
        if (ch === "\r") i++;
      } else if (ch === "\r") { row.push(field); field = ""; if (row.length > 0) rows.push(row); row = []; }
      else field += ch;
    }
  }
  if (field || row.length > 0) { row.push(field); if (row.length > 0) rows.push(row); }
  const maxLen = Math.max(...rows.map((r) => r.length));
  for (const r of rows) while (r.length < maxLen) r.push("");
  return rows;
}

// ── XLSX parser ─────────────────────────────────────────────────────────────

function renderXLSXTable(b64) {
  try {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const wb = XLSX.read(bytes, { type: "array" });
    const sh = wb.SheetNames[0];
    if (!sh) return '<p class="viewer-empty">No sheets found</p>';
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[sh], { header: 1, defval: "" });
    if (rows.length === 0) return '<p class="viewer-empty">Empty sheet</p>';
    const headers = rows[0], dataRows = rows.slice(1);
    let html = '<div class="viewer-table-wrap"><table class="viewer-table"><thead><tr>';
    for (const h of headers) html += '<th>' + escapeHtml(String(h)) + '</th>';
    html += '</tr></thead><tbody>';
    for (const row of dataRows) {
      html += '<tr>';
      for (let i = 0; i < headers.length; i++) html += '<td>' + escapeHtml(String(row[i] || "")) + '</td>';
      html += '</tr>';
    }
    html += '</tbody></table></div>';
    html += '<p class="viewer-table-info">' + dataRows.length + ' rows × ' + headers.length + ' columns — Sheet: ' + escapeHtml(sh) + '</p>';
    return html;
  } catch (err) {
    return '<p class="viewer-empty" style="color:var(--danger)">Failed to parse XLSX: ' + escapeHtml(err.message) + '</p>';
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

async function deleteFile(name) {
  if (!name || !fileMap[name]) return;
  delete fileMap[name];
  await chrome.storage.local.set({ [STORAGE_KEY]: fileMap });
  if (selectedFile === name) { selectedFile = null; viewMode = "raw"; placeholder.style.display = "flex"; contentPane.style.display = "none"; }
  renderSidebar();
}

async function copyContent() {
  if (!selectedFile || !fileMap[selectedFile]) return;
  try {
    await navigator.clipboard.writeText(fileMap[selectedFile].content || "");
    copyBtn.textContent = "Copied!";
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
  } catch {
    copyBtn.textContent = "Failed";
    setTimeout(() => { copyBtn.textContent = "Copy"; }, 1500);
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function iconForFile(name) {
  const ext = name.split(".").pop()?.toLowerCase();
  const map = { md:"📝", json:"📋", csv:"📊", xlsx:"📊", xls:"📊", txt:"📄", js:"📜", ts:"📜", py:"🐍", html:"🌐", css:"🎨", yml:"⚙️", yaml:"⚙️", toml:"⚙️" };
  return map[ext] || "📁";
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(str) {
  return str.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ── Events ───────────────────────────────────────────────────────────────────

refreshBtn.addEventListener("click", loadFiles);
fileList.addEventListener("click", (e) => {
  const item = e.target.closest(".viewer-file-item");
  if (item && item.dataset.file) viewFile(item.dataset.file);
});
deleteBtn.addEventListener("click", () => { if (selectedFile && confirm('Delete "' + selectedFile + '"?')) deleteFile(selectedFile); });
copyBtn.addEventListener("click", copyContent);
if (toggleBtn) toggleBtn.addEventListener("click", toggleViewMode);

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && selectedFile) {
    selectedFile = null; viewMode = "raw";
    placeholder.style.display = "flex"; contentPane.style.display = "none";
    renderSidebar();
  }
});

chrome.storage.onChanged.addListener((changes) => { if (changes[STORAGE_KEY]) loadFiles(); });
loadFiles();
