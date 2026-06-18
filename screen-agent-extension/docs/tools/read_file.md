# read_file

**What it does:** Reads a previously saved file from persistent storage by name. Use to retrieve data stored earlier for analysis or follow-up.

## Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | The file name to read (e.g. `"report.md"`) |

## Return Shape

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether the file was read |
| `content` | `string` | The file's content |
| `name` | `string` | The file name |
| `summary` | `string` | e.g. `Read "report.md" (12.3 KB)` |
| `metadata` | `object` | `{ created: timestamp, modified: timestamp }` |
| `error` | `string` | Error message if `success` is false |

## Chrome APIs Used

- **`chrome.storage.local`** — Reads from the `"agent_files"` key

## Edge Cases

- **No name**: Returns `{ success: false, error: "File name is required" }`
- **File not found**: Returns `{ success: false, error: "File not found: \"notes.md\"" }`
- **Empty file**: Returns `success: true` with `content: ""`

## Special Behavior

- Returns timestamps in `metadata` so the LLM can determine file age
- Size shown in human-readable format in the summary
