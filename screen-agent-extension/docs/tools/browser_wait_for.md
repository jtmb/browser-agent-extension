# browser_wait_for

Waits for a condition on the page (text to appear/disappear, time to pass, or element state change).

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| text | string | No | Wait for text to appear/disappear |
| textGone | string | No | Wait for text to disappear |
| time | number | No | Wait for milliseconds |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "Waited for condition" }]
}
```
