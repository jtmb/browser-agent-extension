# browser_tabs

Manages browser tabs: list, create, close, or select.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| action | string | Yes | "list", "create", "close", or "select" |
| index | number | No | Tab index (for close/select) |
| url | string | No | URL for new tab (create action) |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "Tab list / action result" }]
}
```
