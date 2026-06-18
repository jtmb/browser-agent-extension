# write_file

**What it does:** Writes structured data to a persistent file backed by `chrome.storage.local`. Files survive extension reloads and are available across all tabs. ~10MB total storage limit.

## Parameters

| Param | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | `string` | Yes | File name with extension (e.g. `"report.md"`, `"data.json"`, `"results.csv"`) |
| `content` | `string` | Yes | The complete file content as a string |

## Return Shape

| Field | Type | Description |
|-------|------|-------------|
| `success` | `boolean` | Whether the file was written |
| `summary` | `string` | e.g. `Created "report.md" (12.3 KB)` or `Updated "report.md" (12.3 KB)` |
| `name` | `string` | The file name (trimmed) |
| `size` | `string` | Human-readable size |
| `error` | `string` | Error message if `success` is false |

## Chrome APIs Used

- **`chrome.storage.local`** — Persistent key-value storage

## Storage Format

Under key `"agent_files"`:
```json
{
  "notes.md": {
    "name": "notes.md",
    "content": "# Hello",
    "created": 1700000000000,
    "modified": 1700000000000
  }
}
```

## Edge Cases

- **No name**: Returns `{ success: false, error: "File name is required" }`
- **File too large**: Content > 100 KB returns `{ success: false, error: "File too large (XXX KB). Max is 100 KB." }`
- **Existing file**: Overwrites the content but preserves the original `created` timestamp
- **Empty content**: Allowed — writes empty string content

## Special Behavior

- Automatically tracks `created` and `modified` timestamps
- Size displayed in human-readable format (B, KB, MB)
- Stored in `chrome.storage.local` which is scoped to the extension — not visible to web pages
