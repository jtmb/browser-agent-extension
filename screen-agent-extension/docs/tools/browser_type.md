# browser_type

Types text into an editable element (input, textarea, contenteditable).

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| element | string | Yes | Human description of the element |
| text | string | Yes | Text to type |
| ref | string | No | Accessibility `ref` from the page snapshot |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "Typed text into element e5" }]
}
```
