import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

import { isTauriRuntime } from "../lib/terminal/events";
import type { Workspace } from "../lib/workspace/types";

const LOCAL_STORAGE_WORKSPACES_KEY = "glyph_workspaces_v1";

export function useWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchWorkspaces = useCallback(async (): Promise<Workspace[]> => {
    setLoading(true);
    setError(null);

    if (isTauriRuntime()) {
      try {
        const list = await invoke<Workspace[]>("get_workspaces");
        setWorkspaces(list);
        setLoading(false);
        return list;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[useWorkspaces] get_workspaces error:", msg);
        setError(msg);
        setLoading(false);
        return [];
      }
    } else {
      // Web fallback using localStorage
      try {
        const raw = localStorage.getItem(LOCAL_STORAGE_WORKSPACES_KEY);
        const list: Workspace[] = raw ? JSON.parse(raw) : [];
        setWorkspaces(list);
        setLoading(false);
        return list;
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        setLoading(false);
        return [];
      }
    }
  }, []);

  useEffect(() => {
    void fetchWorkspaces();
  }, [fetchWorkspaces]);

  const saveWorkspace = useCallback(
    async (workspace: Workspace): Promise<Workspace> => {
      setError(null);
      if (isTauriRuntime()) {
        try {
          const saved = await invoke<Workspace>("save_workspace", { workspace });
          await fetchWorkspaces();
          return saved;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[useWorkspaces] save_workspace error:", msg);
          setError(msg);
          throw new Error(msg);
        }
      } else {
        try {
          const raw = localStorage.getItem(LOCAL_STORAGE_WORKSPACES_KEY);
          const list: Workspace[] = raw ? JSON.parse(raw) : [];
          const idx = list.findIndex((w) => w.id === workspace.id);
          const updated = {
            ...workspace,
            updatedAt: Date.now(),
            createdAt: workspace.createdAt || Date.now(),
          };
          if (idx >= 0) {
            list[idx] = updated;
          } else {
            list.unshift(updated);
          }
          localStorage.setItem(LOCAL_STORAGE_WORKSPACES_KEY, JSON.stringify(list));
          setWorkspaces(list);
          return updated;
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          throw new Error(msg);
        }
      }
    },
    [fetchWorkspaces],
  );

  const deleteWorkspace = useCallback(
    async (id: string): Promise<void> => {
      setError(null);
      if (isTauriRuntime()) {
        try {
          await invoke("delete_workspace", { id });
          await fetchWorkspaces();
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[useWorkspaces] delete_workspace error:", msg);
          setError(msg);
          throw new Error(msg);
        }
      } else {
        try {
          const raw = localStorage.getItem(LOCAL_STORAGE_WORKSPACES_KEY);
          let list: Workspace[] = raw ? JSON.parse(raw) : [];
          list = list.filter((w) => w.id !== id);
          localStorage.setItem(LOCAL_STORAGE_WORKSPACES_KEY, JSON.stringify(list));
          setWorkspaces(list);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          setError(msg);
          throw new Error(msg);
        }
      }
    },
    [fetchWorkspaces],
  );

  return {
    workspaces,
    loading,
    error,
    fetchWorkspaces,
    saveWorkspace,
    deleteWorkspace,
  };
}
