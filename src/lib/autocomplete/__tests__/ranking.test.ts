import test from "node:test";
import assert from "node:assert/strict";
import { rankAndDeduplicateCandidates } from "../ranking.js";
import type { CompletionCandidate } from "../types.js";

test("rankAndDeduplicateCandidates sorts candidates by score descending", () => {
  const candidates: CompletionCandidate[] = [
    { text: "git clone", type: "subcommand", source: "Git", score: 500, replacementStart: 0, replacementEnd: 3 },
    { text: "git checkout", type: "subcommand", source: "Git", score: 850, replacementStart: 0, replacementEnd: 3 },
    { text: "git commit", type: "subcommand", source: "Git", score: 700, replacementStart: 0, replacementEnd: 3 },
  ];

  const ranked = rankAndDeduplicateCandidates(candidates);
  assert.equal(ranked[0]?.text, "git checkout");
  assert.equal(ranked[1]?.text, "git commit");
  assert.equal(ranked[2]?.text, "git clone");
});

test("rankAndDeduplicateCandidates merges duplicate candidates keeping highest score", () => {
  const candidates: CompletionCandidate[] = [
    { text: "docker", type: "command", source: "$PATH", score: 600, replacementStart: 0, replacementEnd: 3 },
    { text: "docker", type: "history", source: "History", score: 950, description: "Recent command", replacementStart: 0, replacementEnd: 3 },
  ];

  const ranked = rankAndDeduplicateCandidates(candidates);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0]?.text, "docker");
  assert.equal(ranked[0]?.score, 950);
  assert.equal(ranked[0]?.description, "Recent command");
});

test("rankAndDeduplicateCandidates limits results to maxResults", () => {
  const candidates: CompletionCandidate[] = Array.from({ length: 15 }, (_, i) => ({
    text: `command-${i}`,
    type: "command",
    source: "$PATH",
    score: 100 + i,
    replacementStart: 0,
    replacementEnd: 5,
  }));

  const ranked = rankAndDeduplicateCandidates(candidates, 5);
  assert.equal(ranked.length, 5);
  assert.equal(ranked[0]?.text, "command-14"); // highest score first
});
