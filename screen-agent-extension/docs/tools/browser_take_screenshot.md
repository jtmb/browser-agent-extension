# browser_take_screenshot

Captures a screenshot of the current page. Used as a last-resort observation tool when accessibility snapshots are insufficient.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| (none) | — | — | No parameters (screenshots full viewport) |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "Screenshot captured" }]
}
```

Note: Screenshots are not sent to the LLM as images (LM Studio vision not currently used). Used for user-visible feedback.
