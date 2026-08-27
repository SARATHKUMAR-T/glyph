import { useEffect, useState } from "react";
import { splitNodeToWorkspaceLayout } from "../../lib/workspace/treeConverter";
import type { TerminalTabModel } from "../../lib/terminal/types";
import type { Workspace, WorkspacePaneConfig } from "../../lib/workspace/types";

type SaveCurrentWorkspaceModalProps = {
  isOpen: boolean;
  activeTab: TerminalTabModel;
  onClose: () => void;
  onSave: (workspace: Workspace) => Promise<Workspace>;
};

export function SaveCurrentWorkspaceModal({
  isOpen,
  activeTab,
  onClose,
  onSave,
}: SaveCurrentWorkspaceModalProps) {
  const [name, setName] = useState(activeTab.title || "Glyph Workspace");
  const [description, setDescription] = useState("");
  const [panes, setPanes] = useState<WorkspacePaneConfig[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && activeTab) {
      const converted = splitNodeToWorkspaceLayout(activeTab.rootNode);
      setPanes(converted.panes);
      setName(activeTab.title || "Glyph Workspace");
    }
  }, [isOpen, activeTab]);

  if (!isOpen) return null;

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

    setIsSubmitting(true);
    setError(null);

    try {
      const converted = splitNodeToWorkspaceLayout(activeTab.rootNode);

      // Merge user edits into converted panes
      const finalPanes = converted.panes.map((p, i) => {
        const edited = panes[i];
        return {
          ...p,
          name: edited?.name || p.name,
          cwd: edited?.cwd ?? p.cwd,
          command: typeof edited?.command === "string" ? edited.command : edited?.command ?? p.command,
        };
      });

      const newWorkspace: Workspace = {
        id: "",
        name: name.trim(),
        description: description.trim() || null,
        layout: converted.layout,
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
          <span className="workspace-modal-title">Save Current Workspace</span>
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
                placeholder="e.g. Saved environment layout"
              />
            </div>

            <div className="form-group">
              <label className="form-label">Captured Panes ({panes.length})</label>
              <div className="pane-config-list">
                {panes.map((pane, idx) => {
                  const cmdStr = typeof pane.command === "string"
                    ? pane.command
                    : pane.command
                      ? `${pane.command.program} ${pane.command.args.join(" ")}`
                      : "";

                  return (
                    <div key={pane.id || idx} className="pane-config-item">
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
              {isSubmitting ? "Saving..." : "Save Workspace"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
