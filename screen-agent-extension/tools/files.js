/**
 * File I/O tools for the Screen Agent.
 *
 * Provides persistent file storage backed by chrome.storage.local.
 * Files survive extension reloads and are available across all tabs.
 * ~10MB total storage limit — ample for markdown, JSON, and CSV documents.
 *
 * Storage format (under key "agent_files"):
 *   {
 *     "notes.md": { name: "notes.md", content: "# Hello", created: 1700000000000, modified: 1700000000000 },
 *     "data.json": { ... }
 *   }
 */

const STORAGE_KEY = "agent_files";

/** Maximum file size: 100 KB per file to prevent storage bloat */
const MAX_FILE_SIZE = 100 * 1024;

/**
 * Get all files as a map { filename → metadata }.
 *
 * @returns {Promise<object>}
 */
async function getFileMap() {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return stored[STORAGE_KEY] || {};
}

/**
 * Save the file map back to storage.
 *
 * @param {object} fileMap
 */
async function saveFileMap(fileMap) {
  await chrome.storage.local.set({ [STORAGE_KEY]: fileMap });
}

/**
 * Write a file to persistent storage. Creates or overwrites.
 *
 * @param {string} name - File name (e.g. "notes.md", "data.json", "report.csv")
 * @param {string} content - The file content as a string
 * @returns {Promise<object>} { success, summary, name }
 */
export async function writeFile(name, content) {
  if (!name || !name.trim()) {
    return { success: false, error: "File name is required" };
  }

  // Guard against oversized content from verbose LLM output
  const contentStr = content || "";
  if (contentStr.length > MAX_FILE_SIZE) {
    return {
      success: false,
      error: "File too large (" + (contentStr.length / 1024).toFixed(0) + " KB). Max is " + (MAX_FILE_SIZE / 1024) + " KB.",
    };
  }

  const fileMap = await getFileMap();
  const now = Date.now();
  const existed = fileMap[name] !== undefined;

  fileMap[name] = {
    name: name.trim(),
    content: content || "",
    created: existed ? fileMap[name].created : now,
    modified: now,
  };

  await saveFileMap(fileMap);

  const size = new Blob([content]).size;
  const sizeStr = size < 1024 ? size + " B" : size < 1024 * 1024 ? (size / 1024).toFixed(1) + " KB" : (size / (1024 * 1024)).toFixed(1) + " MB";

  return {
    success: true,
    summary: (existed ? "Updated" : "Created") + " \"" + name.trim() + "\" (" + sizeStr + ")",
    name: name.trim(),
    size: sizeStr,
  };
}

/**
 * Read a file from persistent storage.
 *
 * @param {string} name - File name to read
 * @returns {Promise<object>} { success, content, name, metadata?, summary }
 */
export async function readFile(name) {
  if (!name || !name.trim()) {
    return { success: false, error: "File name is required" };
  }

  const fileMap = await getFileMap();
  const file = fileMap[name.trim()];

  if (!file) {
    return { success: false, error: "File not found: \"" + name.trim() + "\"" };
  }

  const size = new Blob([file.content]).size;
  const sizeStr = size < 1024 ? size + " B" : (size / 1024).toFixed(1) + " KB";

  return {
    success: true,
    content: file.content,
    name: file.name,
    summary: "Read \"" + file.name + "\" (" + sizeStr + ")",
    metadata: {
      created: file.created,
      modified: file.modified,
    },
  };
}

/**
 * List all stored files with metadata.
 *
 * @returns {Promise<object>} { success, files: [{name, created, modified, size}] }
 */
export async function listFiles() {
  const fileMap = await getFileMap();
  const names = Object.keys(fileMap);

  if (names.length === 0) {
    return { success: true, files: [], summary: "No files stored." };
  }

  const files = names.map((name) => {
    const f = fileMap[name];
    const size = new Blob([f.content]).size;
    return {
      name: f.name,
      size: size < 1024 ? size + " B" : (size / 1024).toFixed(1) + " KB",
      created: f.created,
      modified: f.modified,
    };
  });

  return {
    success: true,
    files,
    summary: names.length + " file(s) stored: " + names.join(", "),
  };
}

/**
 * Delete a file from storage.
 *
 * @param {string} name - File name to delete
 * @returns {Promise<object>} { success, summary }
 */
export async function deleteFile(name) {
  if (!name || !name.trim()) {
    return { success: false, error: "File name is required" };
  }

  const fileMap = await getFileMap();
  const key = name.trim();

  if (!fileMap[key]) {
    return { success: false, error: "File not found: \"" + key + "\"" };
  }

  delete fileMap[key];
  await saveFileMap(fileMap);

  return { success: true, summary: "Deleted \"" + key + "\"" };
}

/**
 * Execute a file-related tool call.
 * Dispatches based on toolCall.function.name.
 *
 * @param {object} toolCall - OpenAI-format tool call object
 * @returns {Promise<object>} The tool result
 */
export async function executeFileTool(toolCall) {
  const fn = toolCall.function;
  let args;

  try {
    args = JSON.parse(fn.arguments);
  } catch {
    return { success: false, error: "Invalid JSON arguments" };
  }

  switch (fn.name) {
    case "write_file":
      return writeFile(args.name, args.content);
    case "read_file":
      return readFile(args.name);
    case "list_files":
      return listFiles();
    case "delete_file":
      return deleteFile(args.name);
    default:
      return { success: false, error: "Unknown file tool: " + fn.name };
  }
}
