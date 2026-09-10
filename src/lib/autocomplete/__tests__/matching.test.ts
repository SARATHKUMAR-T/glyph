import test from "node:test";
import assert from "node:assert/strict";
import { matchCandidate } from "../matching.js";

test("matchCandidate returns highest score for exact match", () => {
  const res = matchCandidate("docker", "docker");
  assert.equal(res.matched, true);
  assert.equal(res.score, 1000);
  assert.deepEqual(res.matchedIndices, [0, 1, 2, 3, 4, 5]);
});

test("matchCandidate returns high score for prefix match", () => {
  const res = matchCandidate("doc", "docker");
  assert.equal(res.matched, true);
  assert.ok(res.score >= 700);
  assert.deepEqual(res.matchedIndices, [0, 1, 2]);
});

test("matchCandidate handles case-insensitive prefix match", () => {
  const res = matchCandidate("Doc", "Documents/");
  assert.equal(res.matched, true);
  assert.ok(res.score >= 650);
  assert.deepEqual(res.matchedIndices, [0, 1, 2]);
});

test("matchCandidate handles substring match", () => {
  const res = matchCandidate("compose", "docker-compose");
  assert.equal(res.matched, true);
  assert.ok(res.score >= 400);
});

test("matchCandidate handles fuzzy subsequence match (gco -> git checkout)", () => {
  const res = matchCandidate("gco", "git checkout");
  assert.equal(res.matched, true);
  assert.ok(res.score > 0);
  assert.ok(res.score < 600); // Fuzzy scores lower than direct prefix
  assert.equal(res.matchedIndices.length, 3);
});

test("matchCandidate returns not matched for non-matching strings", () => {
  const res = matchCandidate("xyz", "docker");
  assert.equal(res.matched, false);
  assert.equal(res.score, 0);
  assert.deepEqual(res.matchedIndices, []);
});
