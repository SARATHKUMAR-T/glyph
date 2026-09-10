import test from "node:test";
import assert from "node:assert/strict";
import { tokenizeCommandLine } from "../tokenizer.js";

test("tokenizeCommandLine parses simple single command", () => {
  const result = tokenizeCommandLine("git", 3);
  assert.equal(result.command, "git");
  assert.equal(result.isInitialCommand, true);
  assert.equal(result.activeToken.clean, "git");
  assert.equal(result.activeToken.start, 0);
  assert.equal(result.activeToken.end, 3);
});

test("tokenizeCommandLine parses command and subcommand", () => {
  const result = tokenizeCommandLine("git checkout", 12);
  assert.equal(result.command, "git");
  assert.equal(result.subcommand, "checkout");
  assert.equal(result.isInitialCommand, false);
  assert.equal(result.activeToken.clean, "checkout");
  assert.equal(result.activeTokenIndex, 1);
});

test("tokenizeCommandLine handles trailing whitespace with virtual token", () => {
  const result = tokenizeCommandLine("git ", 4);
  assert.equal(result.command, "git");
  assert.equal(result.isInitialCommand, false);
  assert.equal(result.activeToken.clean, "");
  assert.equal(result.activeToken.start, 4);
  assert.equal(result.activeToken.end, 4);
  assert.equal(result.activeTokenIndex, 1);
});

test("tokenizeCommandLine detects flags", () => {
  const result = tokenizeCommandLine("ls -la", 6);
  assert.equal(result.command, "ls");
  assert.equal(result.isFlag, true);
  assert.equal(result.activeToken.clean, "-la");
});

test("tokenizeCommandLine detects path-like arguments", () => {
  const result = tokenizeCommandLine("cat src/components/TerminalView.tsx", 36);
  assert.equal(result.command, "cat");
  assert.equal(result.isPathLike, true);
  assert.equal(result.activeToken.clean, "src/components/TerminalView.tsx");
});

test("tokenizeCommandLine handles double-quoted strings with spaces", () => {
  const result = tokenizeCommandLine('git commit -m "initial commit"', 30);
  assert.equal(result.command, "git");
  assert.equal(result.tokens.length, 4);
  assert.equal(result.tokens[3]?.clean, "initial commit");
});

test("tokenizeCommandLine handles cursor in middle of input", () => {
  const result = tokenizeCommandLine("git checkout main", 7); // inside "checkout"
  assert.equal(result.command, "git");
  assert.equal(result.activeToken.clean, "checkout");
  assert.equal(result.activeTokenIndex, 1);
});
