# browser_handle_dialog

Accepts or dismisses a browser dialog (alert, confirm, prompt).

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| accept | boolean | Yes | True to accept, false to dismiss |
| promptText | string | No | Text to enter for prompt dialogs |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "Handled dialog" }]
}
```
