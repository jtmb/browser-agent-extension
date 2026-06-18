# list_files

**What it does:** Lists all saved files with their names, sizes, and timestamps. Use to see what data is stored before reading specific files.

## Parameters

None.

## Return Shape

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether the listing succeeded |
| `files` | `array` | Array of `{ name, size, created, modified }` |
| `summary` | `string` | e.g. `3 file(s) stored: notes.md, data.json, report.csv` |

## Chrome APIs Used

- **`chrome.storage.local`** — Reads the `"agent_files"` key

## Edge Cases

- **No files**: Returns `{ success: true, files: [], summary: "No files stored." }`

## Special Behavior

- Lists all files from the `agent_files` storage key
- Sizes are human-readable (B, KB)
- Timestamps are Unix milliseconds
