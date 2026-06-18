<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->


<!-- BEGIN:documentation-rules -->
# AGENTS.md — Mandatory Pre-Read

Before implementing, writing, editing, or deleting any code in this repository, you MUST:

1. Read this file for project conventions, architecture, common patterns, and documentation rules
2. Follow all rules and conventions documented here
3. After making changes, re-read relevant sections and update anything that is now wrong

**Do not skip this step.** AGENTS.md is the source of truth for how this codebase works. Treat it as a mandatory pre-read before any code work.
<!-- END:documentation-rules -->


<!-- BEGIN:code-comments -->
# Code Comments — Mandatory

Every function, class, non-obvious block, and exported symbol MUST have a human-readable comment explaining **why** it exists and **what** it does. Follow these rules:

- Write comments as if explaining to a new teammate — plain English, no jargon shortcuts.
- Focus on intent and edge cases, not restating the code.
- Keep comments up to date when logic changes. Stale comments are worse than no comments.
- JSDoc / TSDoc for public APIs; inline `//` for internal logic that isn't self-evident.
<!-- END:code-comments -->

<!-- BEGIN:documentation-step -->
# Docs — Always Keep Them In Sync

Every source change must update the corresponding docs in `docs/` at the repo root. Docs must be human-readable and structured so other LLMs can consume them.

1. Check which docs in `docs/` at the repo root cover the behavior you changed
2. Re-read those docs
3. Update anything that's now wrong. If no doc covers it, create one.

**Do not defer.** Apply doc updates in the same turn as the code change. Treat docs as part of the feature.
<!-- END:documentation-step -->


<!-- BEGIN:test-before-done -->
# Test Before You're Done

Never claim a change is complete until you have verified it. Before wrapping up:

1. **Lint & type-check** — run the project's linter and TypeScript compiler. Fix every error.
2. **Build check** — ensure `next build` (or equivalent) succeeds with no warnings you introduced.
3. **Manual smoke test** — if the change touches UI or API behavior, run the dev server and hit the affected path at least once.
4. **Existing tests** — run `npm test` (or equivalent). If existing tests break, fix them before declaring done.
5. **Add tests** — if you added new logic, add at least one test that would fail without your change.

If any step fails, fix it and re-run. Only say "done" when everything is green.
<!-- END:test-before-done -->


<!-- BEGIN:reusable-code -->
# Reusable Code & Global Stylesheet — Mandatory

Don't repeat yourself. Every piece of logic and styling must live in exactly one place.

## Reusable Blocks

- **Extract, don't duplicate.** If the same logic appears in two places, pull it into a shared utility, hook, or component.
- **UI components belong in `components/ui/`.** Buttons, inputs, cards, dialogs — these are shared primitives. Don't inline them in page-level code.
- **Shared utilities go in `lib/`.** Date formatting, string helpers, API wrappers — anything used across multiple files lives here.
- **Custom hooks are preferred over repeated `useEffect` / `useState` patterns.** If two components share stateful logic, extract a hook.

## Global Stylesheet

- **All global CSS lives in `src/app/globals.css`.** Colors, typography, spacing variables, resets, utility classes — one file, one source of truth.
- **No inline `<style>` tags or `style={{}}` objects.** Use Tailwind utility classes or CSS Modules instead.
- **No per-component global stylesheets.** If a component needs unique styles, use a CSS Module (`.module.css`) co-located with the component file.
- **Keep the cascade flat.** Avoid deep nesting and overly specific selectors. Prefer composition over inheritance.
- **Design tokens first.** Define CSS custom properties (`--color-primary`, `--spacing-md`, etc.) in `globals.css` and reference them everywhere else. Never hardcode hex values or pixel sizes in components.
<!-- END:reusable-code -->

<!-- BEGIN:screen-agent-tool-rules -->
# Screen Agent — Tool Registration Rules

Browser tools use `chrome.debugger` CDP — no individual implementor modules needed. Local tools live in the extension.

## Adding a New Local Tool

1. `background.js` — Add dispatch in `executeLocalTool()` function
2. `lib/mcp-tools.js` — Add tool definition in `getLocalToolDefinitions()` and name to `LOCAL_TOOL_NAMES`
3. `src/sidepanel/types.ts` — Add any new result types or interfaces
4. `src/sidepanel/components/SettingsPanel.tsx`:
   - Add display name to `TOOL_LABELS`
   - Add the ID to `ALL_TOOL_NAMES`
   - If it should always be available, add to `OBSERVE_TOOLS`
5. `docs/TOOLS.md` — Document the tool in the index table
6. `docs/tools/<tool_name>.md` — Create a per-tool documentation page with parameters and return shape

## Adding Settings Fields

When adding a new setting to `AgentSettings`:
1. Add the field to `src/sidepanel/types.ts`
2. Add default value in `background.js` settings defaults (`handleGetSettings`)
3. Add default value in `src/sidepanel/hooks/useMessages.ts` `DEFAULT_SETTINGS`
4. Add UI in `src/sidepanel/components/SettingsPanel.tsx` (state var + handleSave)
5. Update `docs/ARCHITECTURE.md` settings table
6. If it needs a new message type from background, add handler in `useMessages.ts`

## MCP Tool Notes

- MCP tools are auto-discovered from the Playwright MCP server at connection time
- Tool definitions are converted from MCP JSON Schema to OpenAI format by `lib/mcp-tools.js`
- The `browser_snapshot` tool is always called at turn start for page observability
- Do NOT create implementor modules for MCP tools — they execute on the server

## Adding a New Library Dependency

1. `npm install <package>`
2. If used in service worker (`background.js`): import via relative path only; Chrome MV3 service workers DO NOT support ES module imports from node_modules — copy/bundle the needed code or use `import` from a bundled output
3. Update `docs/ARCHITECTURE.md` key libraries table

## CSS Conventions

- All global styles in `src/sidepanel/styles/app.css`
- CSS custom properties for theming (dark/light via `[data-theme]`)
- New component styles get their own named section with `/* ── Name ── */` header
- Avoid inline `style={{}}` — prefer CSS classes
<!-- END:screen-agent-tool-rules -->

<!-- BEGIN:screen-agent-docs -->
# Screen Agent — Docs Map

| Doc | Covers |
|-----|--------|
| `docs/ARCHITECTURE.md` | Project structure, agent loop, communication flow, libraries |
| `docs/TOKEN-COUNTING.md` | gpt-tokenizer, context window, constants |
| `docs/CONVERSATION-COMPACTION.md` | Auto-summarization when context fills |
| `docs/CONTEXT-GAUGE.md` | SVG circular gauge in chat UI |
| `docs/TOOLS.md` | Tool index — links to per-tool docs, scraping strategy, snapshot format, how to add tools |
| `docs/tools/` | Per-tool documentation (25 files) — parameters, return shapes, MCP protocol for browser tools |
| `docs/TEST-HARNESS.md` | Standalone web page for testing tool execution without the LLM |
<!-- END:screen-agent-docs -->

