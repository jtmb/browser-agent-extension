/**
 * ChatInput — OpenWeb UI-style pill input.
 *
 * A unified rounded container holding a seamless textarea
 * and a circular send/stop button. A "+" button on the left
 * opens a dropdown with Clear chat and Tool mode options.
 */
import React, { useState, useRef, useCallback, KeyboardEvent, useEffect } from "react";

interface Props {
  onSend: (text: string) => void;
  onCancel: () => void;
  onClear: () => void;
  loading: boolean;
  hasMessages: boolean;
  toolMode: boolean;
  onToggleToolMode: () => void;
  subAgents: boolean;
  onToggleSubAgents: () => void;
}

export function ChatInput({ onSend, onCancel, onClear, loading, hasMessages, toolMode, onToggleToolMode, subAgents, onToggleSubAgents }: Props) {
  const [text, setText] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const handleSend = useCallback(() => {
    const trimmed = text.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setText("");
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [text, onSend]);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend]
  );

  const handleInput = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 150) + "px";
  }, []);

  const handleMenuAction = useCallback(
    (action: "clear" | "toolmode" | "subagents" | "viewfiles") => {
      setMenuOpen(false);
      if (action === "clear") onClear();
      if (action === "toolmode") onToggleToolMode();
      if (action === "subagents") onToggleSubAgents();
      if (action === "viewfiles") {
        const url = chrome.runtime.getURL("viewer/viewer.html");
        chrome.tabs.create({ url });
      }
    },
    [onClear, onToggleToolMode, onToggleSubAgents]
  );

  const hasText = text.trim().length > 0;

  return (
    <div className="chat-input-wrapper">
      <div className="chat-input-bar">
        {/* "+" button — left side, opens options dropdown */}
        <div className="input-plus-wrapper" ref={menuRef}>
          <button
            className="input-plus-btn"
            onClick={() => setMenuOpen((prev) => !prev)}
            title="More options"
            aria-label="More options"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          {menuOpen && (
            <div className="input-plus-menu">
              {hasMessages && (
                <button className="input-plus-menu-item" onClick={() => handleMenuAction("clear")}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="3 6 5 6 21 6" />
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                    <path d="M10 11v6" />
                    <path d="M14 11v6" />
                  </svg>
                  <span>Clear chat</span>
                </button>
              )}
              <button className="input-plus-menu-item" onClick={() => handleMenuAction("toolmode")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
                </svg>
                <span>Tool mode</span>
                <span className="input-plus-menu-check">{toolMode ? "✓" : ""}</span>
              </button>
              <button className="input-plus-menu-item" onClick={() => handleMenuAction("subagents")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  <line x1="8" y1="11" x2="14" y2="11" />
                  <line x1="11" y1="8" x2="11" y2="14" />
                </svg>
                <span>Sub-agents</span>
                <span className="input-plus-menu-check">{subAgents ? "✓" : ""}</span>
              </button>
              <div className="input-plus-menu-sep" />
              <button className="input-plus-menu-item" onClick={() => handleMenuAction("viewfiles")}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                </svg>
                <span>View files</span>
              </button>
            </div>
          )}
        </div>

        {/* Main pill */}
        <div className="chat-input-pill">
          <textarea
            ref={textareaRef}
            className="chat-input"
            placeholder="Send a message... (/help for commands)"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            rows={1}
            disabled={loading}
          />
          {loading ? (
            <button className="pill-btn pill-btn-stop" onClick={onCancel} aria-label="Stop generating">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="4" width="16" height="16" rx="3" />
              </svg>
            </button>
          ) : (
            <button
              className={"pill-btn pill-btn-send" + (hasText ? " has-text" : "")}
              onClick={handleSend}
              disabled={!hasText}
              aria-label="Send message"
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <line x1="12" y1="19" x2="12" y2="5" />
                <polyline points="5 12 12 5 19 12" />
              </svg>
            </button>
          )}
        </div>
      </div>

    </div>
  );
}
