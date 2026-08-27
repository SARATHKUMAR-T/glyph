import { useState } from "react";
import { buildNPaneLayout } from "../../lib/workspace/treeConverter";
import { createId } from "../../lib/terminal/splitTree";
import type { Workspace, WorkspacePaneConfig } from "../../lib/workspace/types";

type WorkspaceManagerModalProps = {
  isOpen: boolean;
  workspaces: Workspace[];
  onClose: () => void;
  onOpenWorkspace: (workspace: Workspace) => void;
  onSaveWorkspace: (workspace: Workspace) => Promise<Workspace>;
  onDeleteWorkspace: (id: string) => Promise<void>;
};

export function WorkspaceManagerModal({
  isOpen,
  workspaces,
  onClose,
  onOpenWorkspace,
  onSaveWorkspace,
  onDeleteWorkspace,
}: WorkspaceManagerModalProps) {
  const [editingWs, setEditingWs] = useState<Workspace | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleDelete = async (id: string) => {
    try {
      setError(null);
      await onDeleteWorkspace(id);
      setDeletingId(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const handleAddPaneToEditing = () => {
    if (!editingWs) return;
    setEditingWs((prev) => {
      if (!prev) return null;
      const newPanes = [
        ...prev.panes,
        {
          id: createId(),
          name: `Pane ${prev.panes.length + 1}`,
          cwd: "",
          command: "",
        },
      ];
      return {
        ...prev,
        panes: newPanes,
      };
    });
  };

  const handleRemovePaneFromEditing = (index: number) => {
    if (!editingWs) return;
    setEditingWs((prev) => {
      if (!prev) return null;
      const newPanes = prev.panes.filter((_, i) => i !== index);
      return {
        ...prev,
        panes: newPanes,
      };
    });
  };

  const handleSaveEditing = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingWs) return;

    if (!editingWs.name.trim()) {
      setError("Workspace name cannot be empty.");
      return;
    }

    if (editingWs.panes.length === 0) {
      setError("Workspace must have at least 1 pane.");
      return;
    }

    try {
      setError(null);
      const layout = buildNPaneLayout(editingWs.panes);
      const updatedWs: Workspace = {
        ...editingWs,
        layout,
        updatedAt: Date.now(),
      };

      await onSaveWorkspace(updatedWs);
      setEditingWs(null);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    }
  };

  const handlePaneChange = (
    index: number,
    field: "name" | "cwd" | "commandStr",
    value: string,
  ) => {
    if (!editingWs) return;

    setEditingWs((prev) => {
      if (!prev) return null;
      const copyPanes = [...prev.panes];
      const pane: WorkspacePaneConfig = { ...copyPanes[index] };

      if (field === "name") {
        pane.name = value;
      } else if (field === "cwd") {
        pane.cwd = value || undefined;
      } else if (field === "commandStr") {
        pane.command = value;
      }

      copyPanes[index] = pane;
      return {
        ...prev,
        panes: copyPanes,
      };
    });
  };

  return (
    <div className="workspace-modal-overlay" onClick={onClose}>
      <div className="workspace-modal" onClick={(e) => e.stopPropagation()}>
        <div className="workspace-modal-header">
          <span className="workspace-modal-title">
            {editingWs ? `Edit: ${editingWs.name}` : "Manage Workspaces"}
          </span>
          <button type="button" className="workspace-modal-close" onClick={onClose}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="workspace-modal-body">
          {error && (
            <div style={{ color: "#ff5555", fontSize: "12px", background: "rgba(255, 30, 30, 0.15)", padding: "8px 12px", borderRadius: "5px" }}>
              {error}
            </div>
          )}

          {editingWs ? (
            <form id="edit-ws-form" onSubmit={handleSaveEditing} style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
              <div className="form-group">
                <label className="form-label">Workspace Name</label>
                <input
                  type="text"
                  className="form-input"
                  value={editingWs.name}
                  onChange={(e) => setEditingWs({ ...editingWs, name: e.target.value })}
                  required
                />
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <input
                  type="text"
                  className="form-input"
                  value={editingWs.description || ""}
                  onChange={(e) => setEditingWs({ ...editingWs, description: e.target.value })}
                />
              </div>

              <div className="form-group">
                <label className="form-label">Layout Presets</label>
                <div className="preset-grid">
                  <div className="preset-card is-selected">
                    <span className="preset-card-title">Custom ({editingWs.panes.length} Panes)</span>
                    <span className="preset-card-desc">Balanced split layout</span>
                  </div>
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <label className="form-label">Panes ({editingWs.panes.length})</label>
                  <button
                    type="button"
                    className="btn-glyph btn-glyph-secondary"
                    style={{ height: "26px", fontSize: "11px", padding: "0 10px" }}
                    onClick={handleAddPaneToEditing}
                  >
                    + Add Pane
                  </button>
                </div>

                <div className="pane-config-list">
                  {editingWs.panes.map((pane, idx) => {
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
                          {editingWs.panes.length > 1 && (
                            <button
                              type="button"
                              className="btn-glyph btn-glyph-danger"
                              style={{ height: "22px", fontSize: "10px", padding: "0 6px" }}
                              onClick={() => handleRemovePaneFromEditing(idx)}
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
            </form>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {workspaces.length === 0 ? (
                <div style={{ padding: "20px", textAlign: "center", color: "var(--nothing-gray-500)", fontSize: "13px" }}>
                  No saved workspaces available. Create one using <strong>+ New Workspace</strong> or <strong>Save Current Workspace</strong>.
                </div>
              ) : (
                workspaces.map((ws) => (
                  <div
                    key={ws.id}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "12px 14px",
                      background: "rgba(255, 255, 255, 0.03)",
                      border: "1px solid rgba(255, 255, 255, 0.1)",
                      borderRadius: "6px",
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 600, fontSize: "13px", color: "var(--nothing-white)" }}>{ws.name}</div>
                      {ws.description && (
                        <div style={{ fontSize: "11px", color: "var(--nothing-gray-500)", marginTop: "2px" }}>{ws.description}</div>
                      )}
                      <div style={{ fontSize: "11px", color: "var(--nothing-gray-500)", marginTop: "4px" }}>
                        {ws.panes.length} pane{ws.panes.length === 1 ? "" : "s"} • {new Date(ws.updatedAt).toLocaleDateString()}
                      </div>
                    </div>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                      <button
                        type="button"
                        className="btn-glyph btn-glyph-primary"
                        style={{ height: "28px", fontSize: "11px", padding: "0 10px" }}
                        onClick={() => {
                          onClose();
                          onOpenWorkspace(ws);
                        }}
                      >
                        Open
                      </button>

                      <button
                        type="button"
                        className="btn-glyph btn-glyph-secondary"
                        style={{ height: "28px", fontSize: "11px", padding: "0 10px" }}
                        onClick={() => setEditingWs(ws)}
                      >
                        Edit
                      </button>

                      {deletingId === ws.id ? (
                        <div style={{ display: "flex", gap: "4px" }}>
                          <button
                            type="button"
                            className="btn-glyph btn-glyph-danger"
                            style={{ height: "28px", fontSize: "11px", padding: "0 8px" }}
                            onClick={() => handleDelete(ws.id)}
                          >
                            Confirm Delete
                          </button>
                          <button
                            type="button"
                            className="btn-glyph btn-glyph-secondary"
                            style={{ height: "28px", fontSize: "11px", padding: "0 8px" }}
                            onClick={() => setDeletingId(null)}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="btn-glyph btn-glyph-danger"
                          style={{ height: "28px", fontSize: "11px", padding: "0 8px" }}
                          onClick={() => setDeletingId(ws.id)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        <div className="workspace-modal-footer">
          {editingWs ? (
            <>
              <button
                type="button"
                className="btn-glyph btn-glyph-secondary"
                onClick={() => setEditingWs(null)}
              >
                Back
              </button>
              <button
                type="submit"
                form="edit-ws-form"
                className="btn-glyph btn-glyph-primary"
              >
                Save Changes
              </button>
            </>
          ) : (
            <button type="button" className="btn-glyph btn-glyph-secondary" onClick={onClose}>
              Close
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
