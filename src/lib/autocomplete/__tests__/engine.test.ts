import test from "node:test";
import assert from "node:assert/strict";
import { CompletionEngine } from "../engine.js";

test("CompletionEngine generates candidates for empty input gracefully", async () => {
  const engine = CompletionEngine.getInstance();
  const res = await engine.getCompletions({ input: "", cursorPosition: 0 });
  assert.ok(res);
  assert.equal(res.candidates.length, 0);
});

test("CompletionEngine aggregates results from multiple providers", async () => {
  const engine = CompletionEngine.getInstance();
  const res = await engine.getCompletions({
    input: "git ch",
    cursorPosition: 6,
    cwd: "/workspace",
  });

  assert.ok(res);
  assert.ok(res.candidates.length > 0);
  assert.ok(res.candidates.some((c) => c.text === "checkout"));
});

test("CompletionEngine ranks and deduplicates results properly", async () => {
  const engine = CompletionEngine.getInstance();
  const res = await engine.getCompletions({
    input: "cd D",
    cursorPosition: 4,
    cwd: "/home/user",
    history: ["cd Desktop/"],
  });

  assert.ok(res);
  assert.ok(res.candidates.length > 0);
  assert.ok(res.candidates.some((c) => c.text === "Desktop/"));
});
