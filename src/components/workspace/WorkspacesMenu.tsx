import { useEffect, useRef, useState } from "react";
import type { Workspace } from "../../lib/workspace/types";

type WorkspacesMenuProps = {
  workspaces: Workspace[];
  onOpenWorkspace: (workspace: Workspace) => void;
  onCreateWorkspace: () => void;
  onSaveCurrentWorkspace: () => void;
  onManageWorkspaces: () => void;
};

export function WorkspacesMenu({
  workspaces,
  onOpenWorkspace,
  onCreateWorkspace,
  onSaveCurrentWorkspace,
  onManageWorkspaces,
}: WorkspacesMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [isOpen]);

  return (
    <div className="workspace-menu-container" ref={menuRef} data-tauri-drag-region="false">
      <button
        type="button"
        className={`workspace-menu-trigger ${isOpen ? "is-open" : ""}`}
        data-tauri-drag-region="false"
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          setIsOpen((prev) => !prev);
        }}
        title="Workspaces"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
        <span>Workspaces</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {isOpen && (
        <div className="workspace-menu-dropdown" data-tauri-drag-region="false">
          <div className="workspace-dropdown-header">Saved Workspaces</div>

          <div className="workspace-list-container">
            {workspaces.length === 0 ? (
              <div style={{ padding: "8px 10px", fontSize: "11px", color: "var(--nothing-gray-500)" }}>
                No saved workspaces yet
              </div>
            ) : (
              workspaces.map((ws) => (
                <button
                  key={ws.id}
                  type="button"
                  className="workspace-item-btn"
                  onClick={() => {
                    setIsOpen(false);
                    onOpenWorkspace(ws);
                  }}
                >
                  <span style={{ fontWeight: 600 }}>{ws.name}</span>
                  <span className="workspace-item-meta">{ws.panes?.length || 1} panes</span>
                </button>
              ))
            )}
          </div>

          <div className="workspace-dropdown-divider" />

          <button
            type="button"
            className="workspace-action-btn btn-accent"
            onClick={() => {
              setIsOpen(false);
              onCreateWorkspace();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            <span>New Workspace</span>
          </button>

          <button
            type="button"
            className="workspace-action-btn"
            onClick={() => {
              setIsOpen(false);
              onSaveCurrentWorkspace();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
              <polyline points="17 21 17 13 7 13 7 21" />
              <polyline points="7 3 7 8 15 8" />
            </svg>
            <span>Save Current Workspace</span>
          </button>

          <button
            type="button"
            className="workspace-action-btn"
            onClick={() => {
              setIsOpen(false);
              onManageWorkspaces();
            }}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 20h9" />
              <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
            </svg>
            <span>Manage Workspaces</span>
          </button>
        </div>
      )}
    </div>
  );
}
