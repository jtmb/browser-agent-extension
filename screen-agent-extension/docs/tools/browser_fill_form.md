# browser_fill_form

Fills multiple form fields at once.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| fields | array | Yes | Array of `{ name, type, value, ref? }` objects |

Each field:
- `name`: Field label/description
- `type`: "textbox", "checkbox", or "select"
- `value`: Text to type or option to select
- `ref`: Optional accessibility ref

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "Filled form" }]
}
```
