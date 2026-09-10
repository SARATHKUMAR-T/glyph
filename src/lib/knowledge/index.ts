/**
 * Local Knowledge Layer — Public API
 *
 * This module exposes the LocalKnowledgeManager and all types needed by
 * completion providers and builtin commands.
 *
 * Local Knowledge is deterministic and runs entirely on the user's machine.
 * It does not require AI or network access.
 */

export { LocalKnowledgeManager } from "./manager.js";
export { KnowledgeCache } from "./cache.js";
export type {
  KnowledgeKind,
  KnowledgeSource,
  KnowledgeEntry,
  FsEntry,
  CachedGitData,
  CachedProjectData,
  HistoryEntry,
  KnowledgeStatus,
} from "./types.js";
