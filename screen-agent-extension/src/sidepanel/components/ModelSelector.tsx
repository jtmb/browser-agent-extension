/**
 * ModelSelector — a compact dropdown in the header showing available LM Studio models.
 *
 * Fetches model list from the LM Studio /v1/models endpoint on mount.
 * Uses the current endpoint URL from settings.
 */
import React, { useState, useEffect, useCallback } from "react";

interface Props {
  /** Current LM Studio base URL (e.g. http://127.0.0.1:1234/v1) */
  baseUrl: string;
  /** Currently selected model */
  model: string;
  /** Available models list (fetched externally or passed in) */
  models: string[];
  /** Called when user selects a model */
  onModelChange: (model: string) => void;
  /** Called to refresh the model list */
  onRefreshModels: () => void;
}

export function ModelSelector({ baseUrl, model, models, onModelChange, onRefreshModels }: Props) {
  const [open, setOpen] = useState(false);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    const handler = () => setOpen(false);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [open]);

  const handleSelect = useCallback(
    (m: string) => {
      onModelChange(m);
      setOpen(false);
    },
    [onModelChange]
  );

  const handleToggle = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setOpen((prev) => !prev);
  }, []);

  const displayName = model.split("/").pop() || model;

  return (
    <div className="model-selector">
      <button className="model-select-trigger" onClick={handleToggle} title={model}>
        <span className="model-select-name">{displayName}</span>
        <svg
          className={"model-select-chevron" + (open ? " open" : "")}
          width="10" height="10" viewBox="0 0 24 24"
          fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="model-select-dropdown">
          <div className="model-dropdown-header">
            <span>Models ({models.length})</span>
            <button className="model-refresh-btn" onClick={onRefreshModels} title="Refresh models">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10" />
                <polyline points="23 20 23 14 17 14" />
                <path d="M20.49 9A9 9 0 1 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15" />
              </svg>
            </button>
          </div>
          <div className="model-dropdown-list">
            {models.length === 0 ? (
              <div className="model-dropdown-empty">No models found. Check your endpoint.</div>
            ) : (
              models.map((m) => (
                <button
                  key={m}
                  className={"model-dropdown-item" + (m === model ? " active" : "")}
                  onClick={() => handleSelect(m)}
                >
                  <span className="model-item-name">{m}</span>
                  {m === model && (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
