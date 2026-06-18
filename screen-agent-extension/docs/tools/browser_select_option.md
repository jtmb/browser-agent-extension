# browser_select_option

Selects an option from a dropdown (`<select>`) element.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| element | string | Yes | Human description of the select element |
| value | string | Yes | Option value to select |
| ref | string | No | Accessibility `ref` |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "Selected option" }]
}
```
