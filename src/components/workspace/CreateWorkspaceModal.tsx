import { useState } from "react";
import { buildNPaneLayout, createPresetWorkspaceLayout } from "../../lib/workspace/treeConverter";
import { createId } from "../../lib/terminal/splitTree";
import type { Workspace, WorkspacePaneConfig } from "../../lib/workspace/types";

type CreateWorkspaceModalProps = {
  isOpen: boolean;
  onClose: () => void;
  onSave: (workspace: Workspace) => Promise<Workspace>;
};

type PresetType = "single" | "two-vertical" | "two-horizontal" | "four-grid" | "custom";

export function CreateWorkspaceModal({ isOpen, onClose, onSave }: CreateWorkspaceModalProps) {
  const [name, setName] = useState("Glyph Development");
  const [description, setDescription] = useState("");
  const [preset, setPreset] = useState<PresetType>("four-grid");
  const [panes, setPanes] = useState<WorkspacePaneConfig[]>(() => {
    return createPresetWorkspaceLayout("four-grid", "Glyph Development").panes;
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handlePresetChange = (newPreset: PresetType) => {
    setPreset(newPreset);
    if (newPreset !== "custom") {
      const generated = createPresetWorkspaceLayout(newPreset, name || "Workspace");
      setPanes(generated.panes);
    }
  };

  const handleAddPane = () => {
    setPreset("custom");
    setPanes((prev) => [
      ...prev,
      {
        id: createId(),
        name: `Pane ${prev.length + 1}`,
        cwd: "",
        command: "",
      },
    ]);
  };

  const handleRemovePane = (index: number) => {
    setPreset("custom");
    setPanes((prev) => prev.filter((_, i) => i !== index));
  };

  const handlePaneChange = (
    index: number,
    field: "name" | "cwd" | "commandStr",
    value: string,
  ) => {
    setPanes((prev) => {
      const copy = [...prev];
      const pane = { ...copy[index] };
      if (field === "name") {
        pane.name = value;
      } else if (field === "cwd") {
        pane.cwd = value || undefined;
      } else if (field === "commandStr") {
        pane.command = value;
      }
      copy[index] = pane;
      return copy;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Workspace name cannot be empty.");
      return;
    }
    if (panes.length === 0) {
      setError("Workspace must have at least 1 pane.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Build balanced split tree for N panes
      const layout = buildNPaneLayout(panes);

      const finalPanes = panes.map((p) => ({
        ...p,
        id: p.id || createId(),
        name: p.name || "Terminal",
        command: typeof p.command === "string" ? p.command : p.command,
      }));

      const newWorkspace: Workspace = {
        id: "",
        name: name.trim(),
        description: description.trim() || null,
        layout,
        panes: finalPanes,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      await onSave(newWorkspace);
      setIsSubmitting(false);
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="workspace-modal-overlay" onClick={onClose}>
      <div className="workspace-modal" onClick={(e) => e.stopPropagation()}>
        <div className="workspace-modal-header">
          <span className="workspace-modal-title">Create Workspace</span>
          <button type="button" className="workspace-modal-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: "contents" }}>
          <div className="workspace-modal-body">
            {error && (
              <div style={{ color: "#ff5555", fontSize: "12px", background: "rgba(255, 30, 30, 0.15)", padding: "8px 12px", borderRadius: "5px" }}>
                {error}
              </div>
            )}

            <div className="form-group">
              <label className="form-label">Workspace Name</label>
              <input
                type="text"
                className="form-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Glyph Development"
                required
              />
            </div>

            <div className="form-group">
              <label className="form-label">Description (Optional)</label>
              <input
                type="text"
                className="form-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Fullstack environment"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Layout Presets</label>
              <div className="preset-grid">
                <div
                  className={`preset-card ${preset === "single" ? "is-selected" : ""}`}
                  onClick={() => handlePresetChange("single")}
                >
                  <span className="preset-card-title">Single Pane</span>
                  <span className="preset-card-desc">1 full window terminal</span>
                </div>

                <div
                  className={`preset-card ${preset === "two-vertical" ? "is-selected" : ""}`}
                  onClick={() => handlePresetChange("two-vertical")}
                >
                  <span className="preset-card-title">2 Panes (Side-by-Side)</span>
                  <span className="preset-card-desc">Vertical split</span>
                </div>

                <div
                  className={`preset-card ${preset === "two-horizontal" ? "is-selected" : ""}`}
                  onClick={() => handlePresetChange("two-horizontal")}
                >
                  <span className="preset-card-title">2 Panes (Stacked)</span>
                  <span className="preset-card-desc">Horizontal split</span>
                </div>

                <div
                  className={`preset-card ${preset === "four-grid" ? "is-selected" : ""}`}
                  onClick={() => handlePresetChange("four-grid")}
                >
                  <span className="preset-card-title">4 Panes (Grid)</span>
                  <span className="preset-card-desc">2x2 quad split</span>
                </div>

                {preset === "custom" && (
                  <div
                    className="preset-card is-selected"
                    onClick={() => setPreset("custom")}
                  >
                    <span className="preset-card-title">Custom ({panes.length} Panes)</span>
                    <span className="preset-card-desc">Balanced split layout</span>
                  </div>
                )}
              </div>
            </div>

            <div className="form-group">
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <label className="form-label">Panes ({panes.length})</label>
                <button
                  type="button"
                  className="btn-glyph btn-glyph-secondary"
                  style={{ height: "26px", fontSize: "11px", padding: "0 10px" }}
                  onClick={handleAddPane}
                >
                  + Add Pane
                </button>
              </div>

              <div className="pane-config-list">
                {panes.map((pane, idx) => {
                  const cmdStr = typeof pane.command === "string"
                    ? pane.command
                    : pane.command
                      ? `${pane.command.program} ${pane.command.args.join(" ")}`
                      : "";

                  return (
                    <div key={pane.id || idx} className="pane-config-item">
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--nothing-red-bright)" }}>
                          PANE #{idx + 1}
                        </span>
                        {panes.length > 1 && (
                          <button
                            type="button"
                            className="btn-glyph btn-glyph-danger"
                            style={{ height: "22px", fontSize: "10px", padding: "0 6px" }}
                            onClick={() => handleRemovePane(idx)}
                          >
                            Remove
                          </button>
                        )}
                      </div>

                      <div className="pane-config-row">
                        <div>
                          <label style={{ fontSize: "10px", color: "var(--nothing-gray-500)" }}>Pane Name</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ height: "30px", fontSize: "12px" }}
                            value={pane.name}
                            onChange={(e) => handlePaneChange(idx, "name", e.target.value)}
                          />
                        </div>

                        <div>
                          <label style={{ fontSize: "10px", color: "var(--nothing-gray-500)" }}>Working Directory (CWD)</label>
                          <input
                            type="text"
                            className="form-input"
                            style={{ height: "30px", fontSize: "12px" }}
                            value={pane.cwd || ""}
                            onChange={(e) => handlePaneChange(idx, "cwd", e.target.value)}
                            placeholder="e.g. ~/projects/glyph"
                          />
                        </div>
                      </div>

                      <div>
                        <label style={{ fontSize: "10px", color: "var(--nothing-gray-500)" }}>Startup Command (Optional)</label>
                        <input
                          type="text"
                          className="form-input"
                          style={{ height: "30px", fontSize: "12px" }}
                          value={cmdStr}
                          onChange={(e) => handlePaneChange(idx, "commandStr", e.target.value)}
                          placeholder="e.g. npm run dev or cargo run"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="workspace-modal-footer">
            <button type="button" className="btn-glyph btn-glyph-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="btn-glyph btn-glyph-primary" disabled={isSubmitting}>
              {isSubmitting ? "Creating..." : "Create Workspace"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
