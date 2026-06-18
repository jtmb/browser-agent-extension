/**
 * SettingsPanel — slide-out overlay for configuring the LM Studio connection,
 * managing system prompt profiles, and selecting which tools are available.
 *
 * Sections:
 *  - LM Studio endpoint URL + test button
 *  - Model selector dropdown
 *  - Sub-agents toggle
 *  - Tool checklist with Select All / Deselect All
 *  - System Prompt: profile selector, textarea editor, save/delete profile
 *
 * Tool instructions are ALWAYS appended by the app — users cannot remove them
 * from custom prompts, ensuring the agent always knows how to interact.
 */
import React, { useState, useCallback } from "react";
import type { AgentSettings, SystemPromptProfile } from "../types";

/** Human-readable labels for each tool name (browser + local) */
const TOOL_LABELS: Record<string, string> = {
  browser_snapshot: "Snapshot Page",
  browser_click: "Click",
  browser_type: "Type Text",
  browser_press_key: "Press Key",
  browser_hover: "Hover",
  browser_navigate: "Navigate",
  browser_navigate_back: "Go Back",
  browser_wait_for: "Wait",
  browser_take_screenshot: "Screenshot",
  browser_evaluate: "Evaluate JS",
  browser_fill_form: "Fill Form",
  browser_select_option: "Select Option",
  browser_drag: "Drag & Drop",
  browser_handle_dialog: "Handle Dialog",
  browser_tabs: "Tab Management",
  browser_console_messages: "Console Messages",
  browser_network_requests: "Network Requests",
  browser_file_upload: "File Upload",
  web_search: "Web Search",
  fetch_webpage: "Fetch Webpage",
  download_file: "Download File",
  write_file: "Write File",
  read_file: "Read File",
  list_files: "List Files",
  delete_file: "Delete File",
};

/** All known tool names (order determines display order) */
const ALL_TOOL_NAMES = [
  "browser_snapshot",
  "browser_click",
  "browser_type",
  "browser_press_key",
  "browser_hover",
  "browser_navigate",
  "browser_navigate_back",
  "browser_wait_for",
  "browser_take_screenshot",
  "browser_evaluate",
  "browser_fill_form",
  "browser_select_option",
  "browser_drag",
  "browser_handle_dialog",
  "browser_tabs",
  "browser_console_messages",
  "browser_network_requests",
  "browser_file_upload",
  "web_search",
  "fetch_webpage",
  "download_file",
  "write_file",
  "read_file",
  "list_files",
  "delete_file",
];

/** Tools always available regardless of checkmarks */
const OBSERVE_TOOLS = new Set(["browser_snapshot", "browser_take_screenshot", "browser_evaluate", "browser_console_messages", "browser_network_requests"]);

interface Props {
  settings: AgentSettings;
  models: string[];
  prompts: SystemPromptProfile[];
  onSave: (settings: AgentSettings) => void;
  onClose: () => void;
  onRefreshModels: () => void;
  onRefreshProfiles: () => void;
  onSaveProfile: (name: string, content: string, existingId?: string) => void;
  onDeleteProfile: (id: string) => void;
  onSelectProfile: (id: string) => void;
}

export function SettingsPanel({
  settings,
  models,
  prompts,
  onSave,
  onClose,
  onRefreshModels,
  onSaveProfile,
  onDeleteProfile,
  onSelectProfile,
}: Props) {
  const [baseUrl, setBaseUrl] = useState(settings.baseUrl);
  const [model, setModel] = useState(settings.model);
  const [maxTokens, setMaxTokens] = useState(settings.maxTokens);
  const [contextWindow, setContextWindow] = useState(settings.contextWindow || 262144);
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);
  const [testing, setTesting] = useState(false);

  // System prompt state
  const [promptText, setPromptText] = useState(settings.systemPrompt || "");
  const [profileName, setProfileName] = useState(settings.activeProfileName || "");
  const [selectedProfileId, setSelectedProfileId] = useState<string>("");
  const [promptSaveMsg, setPromptSaveMsg] = useState("");

  // Tool checklist state — derive from settings.enabledTools, default to all
  const [checkedTools, setCheckedTools] = useState<Set<string>>(() => {
    if (settings.enabledTools?.length) return new Set(settings.enabledTools);
    return new Set(ALL_TOOL_NAMES);
  });

  const allChecked = ALL_TOOL_NAMES.every((t) => checkedTools.has(t));

  const toggleTool = useCallback((name: string) => {
    setCheckedTools((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name); else next.add(name);
      return next;
    });
  }, []);

  const toggleAllTools = useCallback(() => {
    if (allChecked) {
      // Deselect all — but always keep observe tools
      setCheckedTools(new Set(ALL_TOOL_NAMES.filter((t) => OBSERVE_TOOLS.has(t))));
    } else {
      setCheckedTools(new Set(ALL_TOOL_NAMES));
    }
  }, [allChecked]);

  /** Test the LM Studio endpoint */
  const handleTest = useCallback(async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const url = baseUrl.replace(/\/+$/, "") + "/models";
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      const count = data?.data?.length ?? 0;
      setTestResult({ ok: true, message: "Connected — " + count + " model(s) found" });
      // Refresh model list after successful test
      onRefreshModels();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Unknown error";
      setTestResult({ ok: false, message: "Failed: " + msg });
    } finally {
      setTesting(false);
    }
  }, [baseUrl, onRefreshModels]);

  /**
   * When the user selects a different model, try to look up its
   * max_context_length from LM Studio's /api/v0/models/{model} endpoint
   * and auto-update the context window size.
   */
  const handleModelChange = useCallback(async (newModel: string) => {
    setModel(newModel);
    try {
      const url = baseUrl.replace(/\/+$/, "") + "/api/v0/models/" + encodeURIComponent(newModel);
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) return;
      const data = await res.json();
      if (data?.max_context_length && data.max_context_length > 0) {
        setContextWindow(data.max_context_length);
      }
    } catch {
      // Silently ignore — user can set context window manually if needed
    }
  }, [baseUrl]);

  /** Save settings back to parent (preserves toolMode and includes prompt + enabledTools + MCP config) */
  const handleSave = useCallback(() => {
    onSave({
      baseUrl,
      model,
      maxTokens,
      contextWindow,
      toolMode: settings.toolMode,
      subAgents: settings.subAgents,
      enabledTools: [...checkedTools],
      systemPrompt: promptText,
      activeProfileName: selectedProfileId
        ? prompts.find((p) => p.id === selectedProfileId)?.name || ""
        : "",
    });
    onClose();
  }, [baseUrl, model, settings, promptText, selectedProfileId, prompts, onSave, onClose, checkedTools]);

  /** Handle profile selection from dropdown */
  const handleProfileSelect = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      const id = e.target.value;
      setSelectedProfileId(id);
      if (id === "") {
        setProfileName("");
        setPromptSaveMsg("");
        return;
      }
      const profile = prompts.find((p) => p.id === id);
      if (profile) {
        setPromptText(profile.content);
        setProfileName(profile.name);
        setPromptSaveMsg("");
      }
    },
    [prompts]
  );

  /** Save the current prompt text as a new or updated profile */
  const handleSaveProfile = useCallback(() => {
    const name = profileName.trim();
    if (!name) {
      setPromptSaveMsg("Enter a name for the profile");
      return;
    }
    if (!promptText.trim()) {
      setPromptSaveMsg("Prompt text is empty");
      return;
    }
    const existing = selectedProfileId
      ? prompts.find((p) => p.id === selectedProfileId)
      : undefined;
    onSaveProfile(name, promptText, existing?.id);
    setPromptSaveMsg("✓ Saved");
    setTimeout(() => setPromptSaveMsg(""), 2000);
  }, [profileName, promptText, selectedProfileId, prompts, onSaveProfile]);

  /** Delete the selected profile and reset */
  const handleDeleteProfile = useCallback(() => {
    if (!selectedProfileId) return;
    onDeleteProfile(selectedProfileId);
    setSelectedProfileId("");
    setPromptText("");
    setProfileName("");
    setPromptSaveMsg("");
  }, [selectedProfileId, onDeleteProfile]);

  /** Reset to default (no custom prompt) */
  const handleResetPrompt = useCallback(() => {
    setSelectedProfileId("");
    setPromptText("");
    setProfileName("");
    setPromptSaveMsg("");
  }, []);

  return (
    <div className="settings-overlay" onClick={onClose}>
      <div className="settings-panel" onClick={(e) => e.stopPropagation()}>
        <div className="settings-header">
          <h3 className="settings-title">Settings</h3>
          <button className="settings-close-btn" onClick={onClose} aria-label="Close settings">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="settings-body">
          {/* Endpoint URL */}
          <label className="settings-field">
            <span className="settings-field-label">LM Studio Endpoint</span>
            <div className="settings-url-row">
              <input
                className="settings-input"
                type="text"
                value={baseUrl}
                onChange={(e) => { setBaseUrl(e.target.value); setTestResult(null); }}
                placeholder="http://127.0.0.1:1234/v1"
              />
              <button
                className="settings-test-btn"
                onClick={handleTest}
                disabled={testing || !baseUrl.trim()}
              >
                {testing ? "..." : "Test"}
              </button>
            </div>
            {testResult && (
              <span className={"settings-test-result" + (testResult.ok ? " ok" : " err")}>
                {testResult.ok ? "✅ " : "❌ "}{testResult.message}
              </span>
            )}
          </label>

          {/* ── Browser Automation ── */}
          <div className="settings-section-title">Browser Automation (CDP)</div>
          <p className="settings-hint">
            The agent uses Chrome DevTools Protocol (chrome.debugger) for browser automation.
            No external processes needed — fully self-contained.
          </p>

          {/* Model selector */}
          <label className="settings-field">
            <span className="settings-field-label">Model</span>
            <select
              className="settings-input"
              value={model}
              onChange={(e) => handleModelChange(e.target.value)}
            >
              {models.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </label>

          {/* Max Output Tokens */}
          <label className="settings-field">
            <span className="settings-field-label">Max Output Tokens</span>
            <span className="settings-field-hint">Limits each LLM response length. Increase for long outputs like CSV exports.</span>
            <input
              className="settings-input"
              type="number"
              min={256}
              max={131072}
              step={256}
              value={maxTokens}
              onChange={(e) => setMaxTokens(Number(e.target.value))}
            />
          </label>

          {/* Context Window Size */}
          <label className="settings-field">
            <span className="settings-field-label">Context Window Size</span>
            <span className="settings-field-hint">Your model's maximum context length in tokens. Used for the context usage gauge and auto-compaction.</span>
            <input
              className="settings-input"
              type="number"
              min={4096}
              max={1048576}
              step={4096}
              value={contextWindow}
              onChange={(e) => setContextWindow(Number(e.target.value))}
            />
          </label>

          {/* ── Sub-agents toggle ── */}
          <div className="settings-section-title">Sub-agents</div>
          <p className="settings-hint">
            When enabled, web searches spawn a sub-agent (separate LLM call) that reads the results and synthesizes a concise answer. When disabled, raw search results are returned directly.
          </p>
          <label className="settings-toggle-row">
            <span className="settings-toggle-label">Use sub-agents for web search</span>
            <button
              className={"settings-toggle" + (settings.subAgents ? " active" : "")}
              onClick={() => {
                const next = !settings.subAgents;
                onSave({ ...settings, subAgents: next });
              }}
              role="switch"
              aria-checked={settings.subAgents}
            >
              <span className="settings-toggle-knob" />
            </button>
          </label>

          {/* ── Tool Checklist ── */}
          <div className="settings-section-title">Tools</div>
          <p className="settings-hint">
            Choose which tools the agent can use. Describe-only tools (screenshot, web search, files) are always available in observe mode.
          </p>
          <div className="settings-tools-header">
            <button
              className="settings-tools-toggle-all"
              onClick={toggleAllTools}
            >
              {allChecked ? "Deselect All" : "Select All"}
            </button>
            <span className="settings-tools-count">
              {checkedTools.size}/{ALL_TOOL_NAMES.length}
            </span>
          </div>
          <div className="settings-tools-list">
            {ALL_TOOL_NAMES.map((name) => {
              const isObserve = OBSERVE_TOOLS.has(name);
              return (
                <label
                  key={name}
                  className={"settings-tool-item" + (isObserve ? " observe-only" : "") + (checkedTools.has(name) ? " checked" : "")}
                >
                  <span className="settings-tool-checkbox">
                    {checkedTools.has(name) && (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                  <span className="settings-tool-name">{TOOL_LABELS[name] || name}</span>
                  <input
                    type="checkbox"
                    className="settings-tool-input"
                    checked={checkedTools.has(name)}
                    onChange={() => toggleTool(name)}
                  />
                </label>
              );
            })}
          </div>

          {/* ── System Prompt section ── */}
          <div className="settings-section-title">System Prompt</div>
          <p className="settings-hint">
            Customize the agent's behavior and personality. Tool instructions are always appended automatically — you cannot override them.
          </p>

          {/* Profile selector */}
          <label className="settings-field">
            <span className="settings-field-label">Profile</span>
            <select
              className="settings-input"
              value={selectedProfileId}
              onChange={handleProfileSelect}
            >
              <option value="">Custom</option>
              {prompts.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </label>

          {/* Prompt textarea */}
          <label className="settings-field">
            <span className="settings-field-label">Prompt Text</span>
            <textarea
              className="settings-textarea"
              value={promptText}
              onChange={(e) => {
                setPromptText(e.target.value);
                setPromptSaveMsg("");
              }}
              placeholder="Leave empty to use the default system prompt..."
              rows={6}
            />
          </label>

          {/* Profile save row */}
          <div className="settings-prompt-actions">
            <input
              className="settings-input settings-prompt-name"
              type="text"
              value={profileName}
              onChange={(e) => setProfileName(e.target.value)}
              placeholder="Profile name..."
            />
            <button
              className="settings-prompt-save-btn"
              onClick={handleSaveProfile}
              disabled={!profileName.trim() || !promptText.trim()}
            >
              Save
            </button>
            {selectedProfileId && (
              <button
                className="settings-prompt-delete-btn"
                onClick={handleDeleteProfile}
              >
                Delete
              </button>
            )}
            {promptText && (
              <button
                className="settings-prompt-reset-btn"
                onClick={handleResetPrompt}
              >
                Reset
              </button>
            )}
          </div>
          {promptSaveMsg && (
            <span className={"settings-prompt-msg" + (promptSaveMsg.startsWith("✓") ? " ok" : "")}>
              {promptSaveMsg}
            </span>
          )}
        </div>

        <div className="settings-footer">
          <button className="settings-save-btn" onClick={handleSave}>Save</button>
          <button className="settings-cancel-btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
