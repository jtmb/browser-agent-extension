# delete_file

Deletes a file from persistent storage (chrome.storage.local).

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| name | string | Yes | File name to delete |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "Deleted file: data.csv" }]
}
```

## CDP Commands

None — uses `chrome.storage.local`.
