/**
 * App shell — theme, layout, model selector, settings panel.
 *
 * The chrome.* API is only available inside the extension context.
 * We check for it at runtime so the same code can render in dev mode
 * without the extension loaded.
 */
import React, { useState, useEffect, useCallback } from "react";
import { ChatWindow } from "./components/ChatWindow";
import { ThemeToggle } from "./components/ThemeToggle";
import { ModelSelector } from "./components/ModelSelector";
import { SettingsPanel } from "./components/SettingsPanel";
import { useMessages } from "./hooks/useMessages";
import type { ThemeMode } from "./types";

function loadTheme(): ThemeMode {
  if (typeof localStorage !== "undefined") {
    const stored = localStorage.getItem("screen-agent-theme");
    if (stored === "dark" || stored === "light") return stored;
  }
  return "dark";
}

export function App() {
  const [theme, setThemeState] = useState<ThemeMode>(loadTheme);
  const [showSettings, setShowSettings] = useState(false);
  const {
    messages,
    loading,
    settings,
    models,
    prompts,
    contextUsage,
    fileNames,
    sendMessage,
    cancel,
    clear,
    updateSettings,
    toggleToolMode,
    toggleSubAgents,
    fetchModels,
    fetchProfiles,
    saveProfile,
    deleteProfile,
    selectProfile,
    bottomRef,
  } = useMessages();

  /** Toggle between dark and light */
  const toggleTheme = useCallback(() => {
    setThemeState((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      if (typeof localStorage !== "undefined") {
        localStorage.setItem("screen-agent-theme", next);
      }
      return next;
    });
  }, []);

  /** Apply theme class to <html> */
  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove("theme-dark", "theme-light");
    root.classList.add("theme-" + theme);
  }, [theme]);

  return (
    <div className="app-shell">
      {/* ── Header: logo, model selector, theme toggle, settings gear ── */}
      <header className="app-header">
        <span className="app-logo">🖥️ Screen Agent</span>
        <div className="app-header-spacer" />
        <ModelSelector
          baseUrl={settings.baseUrl}
          model={settings.model}
          models={models}
          onModelChange={(m) => updateSettings({ ...settings, model: m })}
          onRefreshModels={fetchModels}
        />
        <ThemeToggle theme={theme} onToggle={toggleTheme} />
        <button
          className="header-icon-btn"
          onClick={() => setShowSettings(true)}
          title="Settings"
          aria-label="Open settings"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
        </button>
      </header>

      {/* ── Chat area ── */}
      <ChatWindow
        messages={messages}
        loading={loading}
        onSend={sendMessage}
        onCancel={cancel}
        onClear={clear}
        bottomRef={bottomRef}
        contextUsage={contextUsage}
        fileNames={fileNames}
        toolMode={settings.toolMode}
        onToggleToolMode={toggleToolMode}
        subAgents={settings.subAgents}
        onToggleSubAgents={toggleSubAgents}
      />

      {/* ── Settings slide-out ── */}
      {showSettings && (
        <SettingsPanel
          settings={settings}
          models={models}
          prompts={prompts}
          onSave={updateSettings}
          onClose={() => setShowSettings(false)}
          onRefreshModels={fetchModels}
          onRefreshProfiles={fetchProfiles}
          onSaveProfile={saveProfile}
          onDeleteProfile={deleteProfile}
          onSelectProfile={selectProfile}
        />
      )}
    </div>
  );
}
