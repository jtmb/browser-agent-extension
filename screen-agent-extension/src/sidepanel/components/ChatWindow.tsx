/**
 * ChatWindow — the main chat area.
 *
 * Displays messages in a scrollable container with a fixed bottom input.
 * Styled like OpenWeb UI: dark minimal, clean bubbles, no sidebars.
 * Uses the full width of the side panel (fluid, resizable by Chrome).
 */
import React, { useEffect, useState } from "react";
import { MessageBubble } from "./MessageBubble";
import { ChatInput } from "./ChatInput";
import type { ChatMessage } from "../types";

interface Props {
  messages: ChatMessage[];
  loading: boolean;
  onSend: (text: string) => void;
  onCancel: () => void;
  onClear: () => void;
  bottomRef: React.RefObject<HTMLDivElement | null>;
  toolMode: boolean;
  onToggleToolMode: () => void;
  subAgents: boolean;
  onToggleSubAgents: () => void;
  /** Current context window usage for the circular gauge */
  contextUsage: { used: number; total: number; percent: number };
  /** List of saved file names for making file references clickable */
  fileNames: string[];
}

export function ChatWindow({ messages, loading, onSend, onCancel, onClear, bottomRef, toolMode, onToggleToolMode, subAgents, onToggleSubAgents, contextUsage, fileNames }: Props) {
  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, bottomRef]);

  // Toggle for the detailed tooltip on the context gauge
  const [gaugeExpanded, setGaugeExpanded] = useState(false);

  // Derive live reasoning from the last message while streaming
  const lastMsg = messages.length > 0 ? messages[messages.length - 1] : null;
  const liveReasoning = loading && lastMsg?.reasoning !== undefined && !lastMsg.reasoningDone
    ? lastMsg.reasoning
    : null;

  // Color for the gauge arc based on usage
  const gaugeColor = contextUsage.percent > 85
    ? "var(--color-error, #ef4444)"
    : contextUsage.percent > 60
      ? "var(--color-warning, #f59e0b)"
      : "var(--accent)";

  return (
    <div className="chat-window">
      <div className="chat-messages">
        {messages.length === 0 && (
          <div className="chat-empty">
            <div className="chat-empty-icon">🖥️</div>
            <div className="chat-empty-title">Screen Agent</div>
            <div className="chat-empty-subtitle">
              Ask me to click, type, scroll, or navigate. I see your screen through the extension.
            </div>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} fileNames={fileNames} />
        ))}
        {liveReasoning !== null && (
          <div className="chat-reasoning-stream">
            <span className="chat-reasoning-stream-label">Thinking…</span>
            <em>{liveReasoning}</em><span className="reasoning-cursor">▊</span>
          </div>
        )}
        {loading && liveReasoning === null && (
          <div className="chat-typing">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* ── Context window gauge (fixed bottom-right, outside scroll area) ── */}
      {contextUsage.total > 0 && (
        <div className="chat-context-gauge" onClick={() => setGaugeExpanded(!gaugeExpanded)}>
          <svg width="36" height="36" viewBox="0 0 36 36">
            {/* Background track */}
            <circle
              cx="18" cy="18" r="14"
              fill="none"
              stroke="var(--bg-tertiary)"
              strokeWidth="3"
            />
            {/* Usage arc */}
            <circle
              cx="18" cy="18" r="14"
              fill="none"
              stroke={gaugeColor}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={`${(contextUsage.percent / 100) * 87.96} 87.96`}
              strokeDashoffset="0"
              transform="rotate(-90 18 18)"
              style={{ transition: "stroke-dasharray 0.3s ease, stroke 0.3s ease" }}
            />
            {/* Percentage text */}
            <text
              x="18" y="18"
              textAnchor="middle"
              dominantBaseline="central"
              fill="var(--text-secondary)"
              fontSize="9"
              fontFamily="system-ui, sans-serif"
              fontWeight="600"
            >
              {contextUsage.percent}%
            </text>
          </svg>

          {/* ── Detailed tooltip (shown on click) ── */}
          {gaugeExpanded && (
            <div className="chat-context-gauge-tooltip">
              <div className="gauge-tooltip-title">Context Window</div>
              <div className="gauge-tooltip-row">
                <span>Used</span>
                <span>{contextUsage.used.toLocaleString()} tokens</span>
              </div>
              <div className="gauge-tooltip-row">
                <span>Total</span>
                <span>{contextUsage.total.toLocaleString()} tokens</span>
              </div>
              <div className="gauge-tooltip-row">
                <span>Available</span>
                <span>{(contextUsage.total - contextUsage.used).toLocaleString()} tokens</span>
              </div>
              <div className="gauge-tooltip-bar-track">
                <div
                  className="gauge-tooltip-bar-fill"
                  style={{ width: `${Math.min(contextUsage.percent, 100)}%`, backgroundColor: gaugeColor }}
                />
              </div>
              <div className="gauge-tooltip-hint">Click gauge to dismiss</div>
            </div>
          )}
        </div>
      )}

      <ChatInput
        onSend={onSend}
        onCancel={onCancel}
        onClear={onClear}
        loading={loading}
        hasMessages={messages.length > 0}
        toolMode={toolMode}
        onToggleToolMode={onToggleToolMode}
        subAgents={subAgents}
        onToggleSubAgents={onToggleSubAgents}
      />
    </div>
  );
}
