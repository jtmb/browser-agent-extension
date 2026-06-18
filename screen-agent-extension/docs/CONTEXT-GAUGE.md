# Context Window Gauge

A circular SVG gauge shown in the bottom-right corner of the chat message area, inspired by VS Code Copilot's context indicator.

## Appearance

- **Size**: 36×36px SVG circle
- **Position**: Absolute, bottom-right of `.chat-messages` (8px inset)
- **Opacity**: 70% normally, 100% on hover
- **Track**: Thin gray circle (background)
- **Arc**: Colored stroke proportional to usage (stroke-dasharray)

## Color thresholds

| Usage | Color |
|-------|-------|
| ≤ 60% | Accent (theme primary) |
| 61–85% | Warning yellow |
| > 85% | Error red |

## Tooltip

Hovering shows exact token count: "12,345 / 262,144 tokens"

## Data flow

1. `background.js` sends `{ type: "agent_context", usedTokens, contextWindow }` to the sidepanel
2. `useMessages.ts` handler updates `contextUsage` state
3. `App.tsx` destructures and passes to `ChatWindow`
4. `ChatWindow.tsx` renders the SVG gauge when `contextUsage.total > 0`

## CSS

```css
.chat-context-gauge {
  position: absolute;
  bottom: 8px;
  right: 8px;
  z-index: 5;
  pointer-events: none;
  opacity: 0.7;
  transition: opacity 0.2s;
}
.chat-context-gauge:hover { opacity: 1; }
```

The arc stroke uses `stroke-dasharray` calculated as:
```
(percent / 100) * circumference
```
Where circumference = `2 × π × 14 ≈ 87.96` (r=14 from viewBox 36)
