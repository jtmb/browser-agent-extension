/**
 * MessageBubble — renders a single chat message.
 *
 * Handles:
 *  - User messages (right-aligned)
 *  - Assistant text (left-aligned, full GFM markdown + syntax highlighting)
 *  - Tool calls (minimal inline, VS Code Copilot style)
 *  - Tool results (minimal inline ✓/✗)
 *  - Errors and warnings
 *  - Progress indicators
 */
import React, { useCallback } from "react";
import type { ChatMessage } from "../types";
import { renderMarkdown } from "../lib/markdown";

interface Props {
  message: ChatMessage;
}

/**
 * Intercept clicks on <a> elements inside rendered markdown and open them
 * in a new browser tab via chrome.tabs.create.
 *
 * Sidepanel links are sometimes inert even with target="_blank", so we
 * use the extension API as a reliable fallback.
 */
function handleLinkClick(e: React.MouseEvent<HTMLDivElement>) {
  const target = e.target as HTMLElement;
  const anchor = target.closest("a");
  if (!anchor) return;
  const href = anchor.getAttribute("href");
  if (!href || !/^https?:\/\//i.test(href)) return;
  e.preventDefault();
  chrome.tabs.create({ url: href });
}

export function MessageBubble({ message }: Props) {
  const { role, content, toolCall, toolResult, isError, isWarning, isProgress } = message;

  // Tool call — minimal inline, VS Code Copilot style
  if (toolCall) {
    let displayArgs = toolCall.args;
    try {
      const parsed = JSON.parse(toolCall.args);
      displayArgs = JSON.stringify(parsed);
      if (displayArgs.length > 80) {
        displayArgs = displayArgs.slice(0, 80) + "…";
      }
    } catch {
      if (displayArgs.length > 80) displayArgs = displayArgs.slice(0, 80) + "…";
    }
    return (
      <div className="msg msg-tool-call">
        <span className="tool-fn">{toolCall.name}</span>
        <span className="tool-args-inline">{displayArgs}</span>
      </div>
    );
  }

  // Tool result — minimal inline ✓/✗
  if (toolResult) {
    return (
      <div className={"msg msg-tool-result " + (toolResult.success ? "" : "msg-tool-err")}>
        <span className="tool-result-icon">{toolResult.success ? "✓" : "✗"}</span>
        <span className="tool-fn">{toolResult.name}</span>
        {toolResult.summary && (
          <span className="tool-summary-inline">{toolResult.summary}</span>
        )}
      </div>
    );
  }

  // Progress
  if (isProgress) {
    return <div className="msg msg-progress">{content}</div>;
  }

  // Error
  if (isError) {
    return <div className="msg msg-error">⚠️ {content}</div>;
  }

  // Warning
  if (isWarning) {
    return <div className="msg msg-warning">⚠️ {content}</div>;
  }

  // User message
  if (role === "user") {
    return (
      <div className="msg-row msg-row-user">
        <div className="msg msg-user">
          <div className="msg-content">{content}</div>
        </div>
      </div>
    );
  }

  // Assistant message
  const hasReasoning = message.reasoning !== undefined;
  const showReasoningCursor = hasReasoning && !message.reasoningDone;

  return (
    <div className="msg-row msg-row-assistant">
      <div className="msg msg-assistant">
        {hasReasoning && message.reasoning && (
          <div className="msg-reasoning">
            <span className="msg-reasoning-label">
              {message.reasoningDone ? "Done." : "Thinking…"}
            </span>
            <em>{message.reasoning}</em>
            {showReasoningCursor && <span className="reasoning-inline-cursor">▊</span>}
          </div>
        )}
        {content && (
          <div
            className="msg-content"
            onClick={handleLinkClick}
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        )}
      </div>
    </div>
  );
}
