# browser_file_upload

Uploads files to a file input element on the page.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| element | string | Yes | Human description of the file input |
| paths | array | Yes | Array of absolute file paths to upload |
| ref | string | No | Accessibility `ref` |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "Uploaded files" }]
}
```
