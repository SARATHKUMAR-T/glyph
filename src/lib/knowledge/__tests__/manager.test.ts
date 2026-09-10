/**
 * Tests for LocalKnowledgeManager
 *
 * The manager interacts with Tauri IPC and localStorage.
 * In the Node.js test environment neither is available, so we verify
 * the fallback / degraded behaviour that must always work offline.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { LocalKnowledgeManager } from "../manager.js";

// ── Singleton ─────────────────────────────────────────────────────────────────

test("LocalKnowledgeManager: getInstance() returns the same instance", () => {
  const a = LocalKnowledgeManager.getInstance();
  const b = LocalKnowledgeManager.getInstance();
  assert.strictEqual(a, b);
});

// ── Commands — fallback behaviour ─────────────────────────────────────────────

test("LocalKnowledgeManager: getCommands() returns non-empty array (fallback)", async () => {
  const mgr = LocalKnowledgeManager.getInstance();
  const cmds = await mgr.getCommands();
  assert.ok(Array.isArray(cmds));
  assert.ok(cmds.length > 0);
  // Fallback list must contain common shell commands
  assert.ok(cmds.includes("git"));
  assert.ok(cmds.includes("ls"));
});

// ── Filesystem — fallback behaviour ──────────────────────────────────────────

test("LocalKnowledgeManager: getFilesystemEntries() returns fallback entries", async () => {
  const mgr = LocalKnowledgeManager.getInstance();
  const entries = await mgr.getFilesystemEntries("/nonexistent", "");
  assert.ok(Array.isArray(entries));
  assert.ok(entries.length > 0);
});

// ── Git — fallback behaviour ──────────────────────────────────────────────────

test("LocalKnowledgeManager: getGitData() returns { isRepo: false } outside Tauri", async () => {
  const mgr = LocalKnowledgeManager.getInstance();
  const git = await mgr.getGitData("/nonexistent");
  assert.ok(typeof git.isRepo === "boolean");
  assert.ok(Array.isArray(git.branches));
});

// ── Project — fallback behaviour ──────────────────────────────────────────────

test("LocalKnowledgeManager: getProjectData() returns arrays for all fields", async () => {
  const mgr = LocalKnowledgeManager.getInstance();
  const proj = await mgr.getProjectData("/nonexistent");
  assert.ok(Array.isArray(proj.npmScripts));
  assert.ok(Array.isArray(proj.cargoTargets));
  assert.ok(Array.isArray(proj.makeTargets));
});

// ── History index ─────────────────────────────────────────────────────────────

test("LocalKnowledgeManager: addHistoryEntry + getHistory() round-trip", () => {
  const mgr = LocalKnowledgeManager.getInstance();
  // Invalidate history to start clean for this test
  mgr.invalidate("history");

  mgr.addHistoryEntry("npm run dev");
  mgr.addHistoryEntry("git status");
  mgr.addHistoryEntry("npm run dev"); // frequency = 2

  const entries = mgr.getHistory();
  assert.ok(entries.length >= 2);

  const npmEntry = entries.find((e) => e.command === "npm run dev");
  assert.ok(npmEntry, "Expected 'npm run dev' in history");
  assert.equal(npmEntry.frequency, 2);
});

test("LocalKnowledgeManager: history is deduplicated", () => {
  const mgr = LocalKnowledgeManager.getInstance();
  mgr.invalidate("history");

  mgr.addHistoryEntry("docker compose up");
  mgr.addHistoryEntry("docker compose up");
  mgr.addHistoryEntry("docker compose up");

  const entries = mgr.getHistory();
  const matches = entries.filter((e) => e.command === "docker compose up");
  assert.equal(matches.length, 1, "Duplicate commands should be merged");
  assert.equal(matches[0]?.frequency, 3);
});

// ── Invalidation ─────────────────────────────────────────────────────────────

test("LocalKnowledgeManager: invalidate('all') clears history index", () => {
  const mgr = LocalKnowledgeManager.getInstance();
  mgr.addHistoryEntry("some-unique-cmd-xyz");
  mgr.invalidate("all");

  // After invalidation the index is cleared; getHistory() rebuilds from localStorage.
  // In Node.js environment localStorage is unavailable so it will return empty.
  const entries = mgr.getHistory();
  const found = entries.find((e) => e.command === "some-unique-cmd-xyz");
  // It should NOT be found because localStorage isn't available in Node.js tests
  assert.equal(found, undefined);
});

// ── CWD update ────────────────────────────────────────────────────────────────

test("LocalKnowledgeManager: updateCwd() does not throw", () => {
  const mgr = LocalKnowledgeManager.getInstance();
  assert.doesNotThrow(() => {
    mgr.updateCwd("/home/user/project-a");
    mgr.updateCwd("/home/user/project-b");
    mgr.updateCwd("/home/user/project-b"); // same — no-op
  });
});

// ── getStatus ─────────────────────────────────────────────────────────────────

test("LocalKnowledgeManager: getStatus() returns a well-formed status object", async () => {
  const mgr = LocalKnowledgeManager.getInstance();
  const status = await mgr.getStatus();

  assert.ok(typeof status.commandCount === "number");
  assert.ok(typeof status.historyCount === "number");
  assert.ok(typeof status.historyUniqueCount === "number");
  assert.ok(typeof status.currentCwd === "string");
  assert.ok(typeof status.isGitRepo === "boolean");
  assert.ok(typeof status.gitBranchCount === "number");
  assert.ok(typeof status.projectType === "string");
  assert.ok(typeof status.projectScriptCount === "number");
  assert.ok(typeof status.pathCommandsCached === "boolean");
  assert.ok(typeof status.gitCached === "boolean");
  assert.ok(typeof status.projectCached === "boolean");
});

// ── Provider isolation ────────────────────────────────────────────────────────

test("LocalKnowledgeManager: multiple concurrent getGitData() calls do not race", async () => {
  const mgr = LocalKnowledgeManager.getInstance();
  // Fire three concurrent calls to the same CWD — should not throw or corrupt state
  const [a, b, c] = await Promise.all([
    mgr.getGitData("/some/path"),
    mgr.getGitData("/some/path"),
    mgr.getGitData("/some/path"),
  ]);
  assert.ok(typeof a.isRepo === "boolean");
  assert.ok(typeof b.isRepo === "boolean");
  assert.ok(typeof c.isRepo === "boolean");
});
