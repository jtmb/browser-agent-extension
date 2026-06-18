# browser_snapshot

Captures the accessibility tree snapshot of the current page. This is the **primary observation tool** — the LLM uses it to see all interactive elements and their `ref` identifiers.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| (none) | — | — | Takes no parameters |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "- button \"Save\" [ref=e3]\n- textbox \"Name\" [ref=e5]..." }]
}
```

## Accessibility Tree Format

Each element is on its own line:
```
- ROLE "accessible name" [ref=eXX]
  - CHILD_ROLE "name" [ref=eYY]
```

Elements have `ref` identifiers that are passed to other `browser_*` tools.

## Usage Notes

- The snapshot is captured automatically at the start of every agent turn
- Page interaction tools (`browser_click`, `browser_type`, etc.) use `ref` values from the snapshot
- If a large page produces too much output, use `browser_evaluate` for targeted content extraction
