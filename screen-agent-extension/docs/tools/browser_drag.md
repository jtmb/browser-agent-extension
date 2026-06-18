# browser_drag

Drags an element and drops it onto another element.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| fromElement | string | Yes | Human description of the element to drag |
| toElement | string | Yes | Human description of the drop target |
| fromRef | string | No | Accessibility ref of source |
| toRef | string | No | Accessibility ref of target |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "Dragged element" }]
}
```
