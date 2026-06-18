/**
 * download_file tool for the Screen Agent.
 *
 * Triggers a browser download of a file from a URL. Uses the Chrome
 * downloads API to save the file to the user's local disk.
 *
 * Unlike fetch_webpage (which extracts text), this downloads the raw
 * binary content — zip files, PDFs, images, executables, etc.
 *
 * Use cases:
 *   - Downloading release assets from GitHub
 *   - Saving a generated file from a web app
 *   - Grabbing any binary from a known URL
 *
 * Falls back to fetch+save when the downloads API isn't available
 * (e.g., in non-extension contexts via executeDownloadFile import).
 */

/**
 * Trigger a browser download from a URL.
 *
 * Uses chrome.downloads.download() for direct URL downloads.
 * Falls back to fetching the content and creating a Blob download
 * if the downloads API fails (e.g., CORS-restricted URLs).
 *
 * @param {string} url - The URL to download
 * @param {string} [filename] - Suggested filename (extracted from URL if omitted)
 * @returns {Promise<object>} { success, summary, downloadId?, filename }
 */
export async function executeDownloadFile(url, filename) {
  if (!url || typeof url !== "string") {
    return { success: false, error: "No URL provided" };
  }

  let normalizedUrl = url.trim();
  if (!/^https?:\/\//i.test(normalizedUrl)) {
    normalizedUrl = "https://" + normalizedUrl;
  }

  // Extract filename from URL if not provided
  const suggestedName = filename || extractFilename(normalizedUrl);

  // Strategy 1: chrome.downloads.download (direct URL, browser handles it)
  if (typeof chrome !== "undefined" && chrome.downloads) {
    try {
      const downloadId = await chrome.downloads.download({
        url: normalizedUrl,
        filename: suggestedName,
        saveAs: false,
      });
      return {
        success: true,
        summary: `Download started: "${suggestedName}" (ID: ${downloadId})`,
        downloadId,
        filename: suggestedName,
      };
    } catch (err) {
      // Fall through to strategy 2
      console.warn("chrome.downloads.download failed, trying fetch:", err.message);
    }
  }

  // Strategy 2: Fetch as binary, create Blob, trigger download via data URL
  try {
    const response = await fetch(normalizedUrl);
    if (!response.ok) {
      return { success: false, error: `HTTP ${response.status} ${response.statusText}` };
    }
    const blob = await response.blob();
    const blobUrl = URL.createObjectURL(blob);

    if (typeof chrome !== "undefined" && chrome.downloads) {
      const downloadId = await chrome.downloads.download({
        url: blobUrl,
        filename: suggestedName,
        saveAs: false,
      });
      // Clean up the blob URL after a short delay
      setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      return {
        success: true,
        summary: `Download started: "${suggestedName}" (${formatBytes(blob.size)})`,
        downloadId,
        filename: suggestedName,
        size: blob.size,
      };
    }

    // No downloads API — return the blob URL for the caller to handle
    return {
      success: true,
      summary: `Fetched "${suggestedName}" (${formatBytes(blob.size)}) — ready for download`,
      blobUrl,
      filename: suggestedName,
      size: blob.size,
    };
  } catch (err) {
    return { success: false, error: `Download failed: ${err.message}` };
  }
}

/**
 * Extract a filename from a URL path.
 *
 * @param {string} url
 * @returns {string}
 */
function extractFilename(url) {
  try {
    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    const last = segments[segments.length - 1] || "download";
    // Decode URL-encoded characters
    return decodeURIComponent(last);
  } catch {
    return "download";
  }
}

/**
 * Format bytes into a human-readable string.
 *
 * @param {number} bytes
 * @returns {string}
 */
function formatBytes(bytes) {
  if (bytes < 1024) return bytes + " B";
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
  return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}
