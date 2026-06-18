# download_file

**What it does:** Downloads a file from a URL to the user's computer. Uses the Chrome downloads API to save the file to the default Downloads folder. Designed for binary files (zip, PDF, images, executables) and release assets.

## Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `url` | `string` | Yes | The URL of the file to download (e.g. `"https://github.com/.../release.zip"`) |
| `filename` | `string` | No | Suggested filename. Extracted from the URL path if omitted. |

## Return Shape

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether the download started |
| `summary` | `string` | Human-readable summary |
| `downloadId` | `number?` | Chrome downloads API download ID |
| `filename` | `string` | The filename being saved |
| `size` | `number?` | File size in bytes (only when using fetch strategy) |
| `blobUrl` | `string?` | Blob URL (only when downloads API is unavailable) |
| `error` | `string` | Error message if `success` is false |

## Chrome APIs Used

- **`chrome.downloads.download`** — Primary strategy: direct URL download
- **`fetch()`** — Fallback strategy: fetch as Blob, create data URL
- **`URL.createObjectURL`** / **`URL.revokeObjectURL`** — Blob URL lifecycle

## Edge Cases

- **Missing protocol**: URLs without `http://` or `https://` are auto-prepended with `https://`
- **Downloads API fails**: Falls through to fetch+blob strategy (e.g., CORS-restricted URLs)
- **HTTP errors in fetch fallback**: Returns `{ success: false, error: "HTTP 404 Not Found" }`
- **No filename provided**: Extracted from URL pathname via `extractFilename()`
- **URL-encoded filenames**: `decodeURIComponent` applied to extract the original filename
- **No path segments**: Falls back to filename `"download"`

## Fallback Logic

1. **Strategy 1**: `chrome.downloads.download({ url, filename, saveAs: false })` — direct URL download, browser handles it
2. **Strategy 2**: Fetch as Blob → `URL.createObjectURL(blob)` → `chrome.downloads.download({ url: blobUrl })` → revoke blob URL after 5s
3. **No downloads API**: Returns `{ blobUrl }` for the caller to handle

## Filename Extraction

The `extractFilename(url)` function:
1. Parses the URL's pathname
2. Splits on `/` and takes the last non-empty segment
3. Decodes URL-encoded characters
4. Falls back to `"download"` if no segments found

## Size Formatting

The `formatBytes(bytes)` helper:
- `< 1024`: `"123 B"`
- `< 1024*1024`: `"12.3 KB"`
- `>= 1024*1024`: `"1.2 MB"`

## Special Behavior

- Downloads save to the user's **default Downloads folder** — no save-as dialog (`saveAs: false`)
- Blob URLs are automatically revoked after 5 seconds to prevent memory leaks
- The tool returns immediately when the download **starts** — does not wait for completion
