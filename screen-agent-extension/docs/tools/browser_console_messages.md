# browser_console_messages

Reads console messages (logs, warnings, errors) from the browser page.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| (none) | — | — | Reads all buffered console messages |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "[log] Message 1\n[error] Message 2..." }]
}
```
