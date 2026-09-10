import { useEffect, useRef, useState, useCallback } from "react";
import { AIManager } from "../../lib/ai/manager";
import {
  generateCommandFromNaturalLanguage,
  diagnoseCommand,
  type AIGeneratedCommand,
  type AIDiagnosisResult,
} from "../../lib/ai/assistant";
import type { AIStatusResult } from "../../lib/ai/types";

type AIAssistantOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  onRunCommand: (command: string) => void;
  onInsertCommand: (command: string) => void;
  onOpenSettings?: () => void;
  initialPrompt?: string;
  initialMode?: "generate" | "diagnose";
  diagnoseContext?: {
    command: string;
    exitCode: number;
    errorOutput?: string;
  };
  cwd?: string;
  shell?: string;
};

const SUGGESTIONS = [
  "Kill process on port 3000",
  "Find files larger than 100MB",
  "Undo last git commit but keep changes",
  "Extract .tar.gz archive",
  "Docker container logs with timestamps",
  "List active listening ports with PID",
];

export function AIAssistantOverlay({
  isOpen,
  onClose,
  onRunCommand,
  onInsertCommand,
  onOpenSettings,
  initialPrompt = "",
  initialMode = "generate",
  diagnoseContext,
  cwd,
  shell,
}: AIAssistantOverlayProps) {
  const [prompt, setPrompt] = useState(initialPrompt);
  const [isLoading, setIsLoading] = useState(false);
  const [status, setStatus] = useState<AIStatusResult | null>(null);
  const [result, setResult] = useState<AIGeneratedCommand | null>(null);
  const [diagnosis, setDiagnosis] = useState<AIDiagnosisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);

  // Load status on open
  useEffect(() => {
    if (!isOpen) {
      setResult(null);
      setDiagnosis(null);
      setError(null);
      return;
    }

    void AIManager.getInstance().getStatus().then(setStatus);

    if (initialPrompt) {
      setPrompt(initialPrompt);
    }

    // Auto-focus input
    const timer = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 50);

    return () => clearTimeout(timer);
  }, [isOpen, initialPrompt]);

  // Handle auto-diagnose on initialMode
  useEffect(() => {
    if (isOpen && initialMode === "diagnose" && diagnoseContext && !diagnosis && !isLoading) {
      handleDiagnose();
    }
  }, [isOpen, initialMode, diagnoseContext]);

  const handleGenerate = useCallback(
    async (textToGenerate?: string) => {
      const query = (textToGenerate ?? prompt).trim();
      if (!query || isLoading) return;

      setIsLoading(true);
      setError(null);
      setResult(null);
      setDiagnosis(null);

      try {
        const generated = await generateCommandFromNaturalLanguage(query, { cwd, shell });
        setResult(generated);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoading(false);
      }
    },
    [prompt, isLoading, cwd, shell],
  );

  const handleDiagnose = useCallback(async () => {
    if (!diagnoseContext || isLoading) return;

    setIsLoading(true);
    setError(null);
    setResult(null);
    setDiagnosis(null);

    try {
      const diag = await diagnoseCommand(
        diagnoseContext.command,
        diagnoseContext.exitCode,
        diagnoseContext.errorOutput,
      );
      setDiagnosis(diag);
      if (diag.suggestedFix) {
        setResult({
          command: diag.suggestedFix,
          explanation: diag.diagnosis,
          rawText: diag.rawText,
        });
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [diagnoseContext, isLoading]);

  const handleCopy = useCallback(async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard write error
    }
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Stop propagation so terminal doesn't receive input while typing in AI assistant
    e.stopPropagation();

    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }

    if (e.key === "Enter") {
      e.preventDefault();
      if (result?.command) {
        // Run the generated command directly
        onRunCommand(result.command);
        onClose();
      } else if (!isLoading && prompt.trim()) {
        void handleGenerate();
      }
      return;
    }

    if (e.key === "Tab") {
      e.preventDefault();
      if (result?.command) {
        // Insert into terminal without running
        onInsertCommand(result.command);
        onClose();
      }
    }
  };

  if (!isOpen) return null;

  const isConfigured = status?.enabled && status?.status === "Connected";
  const activeCommand = result?.command || diagnosis?.suggestedFix;

  return (
    <div
      ref={overlayRef}
      className="ai-assistant-overlay"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      role="dialog"
      aria-label="AI Agent Assistant"
    >
      {/* Header */}
      <div className="ai-assistant-header">
        <div className="ai-assistant-title-group">
          <span className="ai-assistant-icon-dot" />
          <span className="ai-assistant-title">AI Assistant</span>
          {status && (
            <span
              className={`ai-assistant-badge ${status.status === "Connected" ? "is-connected" : "is-warning"}`}
            >
              {status.enabled ? `${status.provider} · ${status.model || "no model"}` : "AI Disabled"}
            </span>
          )}
        </div>

        <div className="ai-assistant-header-actions">
          {onOpenSettings && (
            <button
              type="button"
              className="ai-assistant-icon-btn"
              title="AI Settings"
              onClick={() => {
                onClose();
                onOpenSettings();
              }}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="3" />
                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
              </svg>
            </button>
          )}
          <button
            type="button"
            className="ai-assistant-icon-btn ai-assistant-close-btn"
            title="Close Assistant (Esc)"
            onClick={onClose}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="ai-assistant-body">
        {!isConfigured && status && (
          <div className="ai-assistant-warning-banner">
            <div className="ai-assistant-warning-text">
              <strong>AI is {status.enabled ? "currently unreachable" : "disabled"}.</strong>
              <p>
                {status.reason || "Please ensure Ollama is running or configure your model provider in Settings."}
              </p>
            </div>
            {onOpenSettings && (
              <button
                type="button"
                className="ai-assistant-action-btn"
                onClick={() => {
                  onClose();
                  onOpenSettings();
                }}
              >
                Open Settings
              </button>
            )}
          </div>
        )}

        {/* Input Form */}
        <div className="ai-assistant-input-wrap">
          <span className="ai-assistant-prompt-symbol">✨</span>
          <input
            ref={inputRef}
            type="text"
            className="ai-assistant-input"
            placeholder="Ask AI in natural language... (e.g. 'kill process on port 3000', 'git undo commit')"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={isLoading}
          />
          <button
            type="button"
            className="ai-assistant-submit-btn"
            onClick={() => handleGenerate()}
            disabled={isLoading || !prompt.trim()}
          >
            {isLoading ? (
              <span className="ai-assistant-spinner" />
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <line x1="22" y1="2" x2="11" y2="13" />
                <polygon points="22 2 15 22 11 13 2 9 22 2" />
              </svg>
            )}
          </button>
        </div>

        {/* Quick Suggestion Chips */}
        {!result && !isLoading && (
          <div className="ai-assistant-suggestions">
            <span className="ai-assistant-suggestions-label">Try:</span>
            {SUGGESTIONS.slice(0, 4).map((sugg) => (
              <button
                key={sugg}
                type="button"
                className="ai-assistant-chip"
                onClick={() => {
                  setPrompt(sugg);
                  void handleGenerate(sugg);
                }}
              >
                {sugg}
              </button>
            ))}
          </div>
        )}

        {/* Loading indicator */}
        {isLoading && (
          <div className="ai-assistant-loading-state">
            <span className="ai-assistant-spinner large" />
            <span>Generating command with {status?.provider || "AI model"}...</span>
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="ai-assistant-error-card">
            <strong>Error:</strong> {error}
          </div>
        )}

        {/* Result view */}
        {activeCommand && !isLoading && (
          <div className="ai-assistant-result-card">
            <div className="ai-assistant-result-header">
              <span className="ai-assistant-result-label">Suggested Command</span>
              <button
                type="button"
                className="ai-assistant-copy-btn"
                onClick={() => handleCopy(activeCommand)}
                title="Copy command"
              >
                {copied ? "Copied!" : "Copy"}
              </button>
            </div>

            <div className="ai-assistant-command-box">
              <code>{activeCommand}</code>
            </div>

            {result?.explanation && (
              <p className="ai-assistant-explanation">{result.explanation}</p>
            )}

            {diagnosis?.diagnosis && !result?.explanation && (
              <p className="ai-assistant-explanation">{diagnosis.diagnosis}</p>
            )}

            {/* Actions Bar */}
            <div className="ai-assistant-actions-row">
              <button
                type="button"
                className="ai-assistant-primary-btn"
                onClick={() => {
                  onRunCommand(activeCommand);
                  onClose();
                }}
              >
                Run Command <span className="ai-shortcut-pill">↵ Enter</span>
              </button>

              <button
                type="button"
                className="ai-assistant-secondary-btn"
                onClick={() => {
                  onInsertCommand(activeCommand);
                  onClose();
                }}
              >
                Insert into Terminal <span className="ai-shortcut-pill">Tab</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer shortcut bar */}
      <div className="ai-assistant-footer">
        <div className="ai-assistant-footer-shortcuts">
          <span><kbd>Enter</kbd> {activeCommand ? "Run" : "Generate"}</span>
          <span><kbd>Tab</kbd> Insert</span>
          <span><kbd>Esc</kbd> Exit</span>
          <span><kbd>Ctrl+Shift+I</kbd> Toggle</span>
        </div>
      </div>
    </div>
  );
}
