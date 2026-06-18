# browser_network_requests

Reads the network request log from the browser page.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| (none) | — | — | Reads all buffered network requests |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "GET https://... 200\nPOST https://... 201..." }]
}
```
