import test from "node:test";
import assert from "node:assert/strict";
import { tokenizeCommandLine } from "../tokenizer.js";
import { CommandProvider } from "../providers/CommandProvider.js";
import { FilesystemProvider } from "../providers/FilesystemProvider.js";
import { ShellProvider } from "../providers/ShellProvider.js";
import { GitProvider } from "../providers/GitProvider.js";
import { HistoryProvider } from "../providers/HistoryProvider.js";
import { ProjectProvider } from "../providers/ProjectProvider.js";

test("CommandProvider produces executable matches for initial command token", async () => {
  const provider = new CommandProvider();
  const input = "doc";
  const parsed = tokenizeCommandLine(input, 3);
  const candidates = await provider.complete({ input, cursorPosition: 3 }, parsed);

  assert.ok(candidates.length > 0);
  assert.ok(candidates.some((c) => c.text === "docker"));
});

test("CommandProvider returns empty when not at initial command", async () => {
  const provider = new CommandProvider();
  const input = "cat doc";
  const parsed = tokenizeCommandLine(input, 7);
  const candidates = await provider.complete({ input, cursorPosition: 7 }, parsed);

  assert.equal(candidates.length, 0);
});

test("FilesystemProvider completes directory and file names", async () => {
  const provider = new FilesystemProvider();
  const input = "cd De";
  const parsed = tokenizeCommandLine(input, 5);
  const candidates = await provider.complete({ input, cursorPosition: 5, cwd: "/home/user" }, parsed);

  assert.ok(candidates.length > 0);
  assert.ok(candidates.some((c) => c.text === "Desktop/"));
  assert.equal(candidates[0]?.type, "directory");
});

test("ShellProvider completes shell builtins like cd and clear", () => {
  const provider = new ShellProvider();
  const input = "cl";
  const parsed = tokenizeCommandLine(input, 2);
  const candidates = provider.complete({ input, cursorPosition: 2 }, parsed);

  assert.ok(candidates.length > 0);
  assert.ok(candidates.some((c) => c.text === "clear"));
});

test("ShellProvider completes flags like --help", () => {
  const provider = new ShellProvider();
  const input = "git --h";
  const parsed = tokenizeCommandLine(input, 7);
  const candidates = provider.complete({ input, cursorPosition: 7 }, parsed);

  assert.ok(candidates.length > 0);
  assert.ok(candidates.some((c) => c.text === "--help"));
});

test("GitProvider completes git subcommands", async () => {
  const provider = new GitProvider();
  const input = "git ch";
  const parsed = tokenizeCommandLine(input, 6);
  const candidates = await provider.complete({ input, cursorPosition: 6, cwd: "/repo" }, parsed);

  assert.ok(candidates.length > 0);
  assert.ok(candidates.some((c) => c.text === "checkout"));
});

test("GitProvider completes branches for git checkout", async () => {
  // Invalidate cached git data so the fallback is re-applied fresh for this test
  const { LocalKnowledgeManager } = await import("../../knowledge/manager.js");
  LocalKnowledgeManager.getInstance().invalidate("git");

  const provider = new GitProvider();
  const input = "git checkout ma";
  const parsed = tokenizeCommandLine(input, 15);
  const candidates = await provider.complete({ input, cursorPosition: 15, cwd: "/repo" }, parsed);

  assert.ok(candidates.length > 0);
  assert.ok(candidates.some((c) => c.text === "main"));
});

test("HistoryProvider boosts frequently and recently used commands", () => {
  const provider = new HistoryProvider();
  const input = "docker comp";
  const parsed = tokenizeCommandLine(input, 11);
  const history = [
    "git status",
    "docker compose up -d",
    "npm test",
    "docker compose up -d",
  ];

  const candidates = provider.complete(
    { input, cursorPosition: 11, history },
    parsed
  );

  assert.ok(candidates.length > 0);
  assert.ok(candidates.some((c) => c.text === "docker compose up -d"));
  assert.ok(candidates[0]?.description?.includes("Used 2 times"));
});

test("ProjectProvider completes npm run scripts", async () => {
  const provider = new ProjectProvider();
  const input = "npm run bu";
  const parsed = tokenizeCommandLine(input, 10);
  const candidates = await provider.complete({ input, cursorPosition: 10, cwd: "/project" }, parsed);

  assert.ok(candidates.length > 0);
  assert.ok(candidates.some((c) => c.text === "build"));
});
