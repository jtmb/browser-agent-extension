# browser_evaluate

Executes JavaScript in the page context. Use for targeted data extraction when the accessibility snapshot is too large.

## Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| function | string | Yes | JavaScript function body to execute |

## Return Shape

```json
{
  "content": [{ "type": "text", "text": "Result of evaluating JS" }]
}
```

## Usage Notes

- For scraping: `document.querySelectorAll('...')` to extract structured data
- The function must be a string of valid JavaScript
