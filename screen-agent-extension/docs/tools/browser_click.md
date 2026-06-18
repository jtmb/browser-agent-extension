# browser_click

Clicks an element on the page, identified by accessibility `ref` or a human-readable `element` description.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| element | string | Yes | Human description of the element (e.g., "Save button") |
| ref | string | No | Accessibility `ref` from the page snapshot |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "Clicked element e3" }]
}
```

## Usage Notes

- Prefer `ref` for precision. If not provided, Playwright MCP matches by description
- Double-click with `browser_drag` for drag-and-drop scenarios
