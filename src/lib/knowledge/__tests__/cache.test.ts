/**
 * Tests for KnowledgeCache
 */
import test from "node:test";
import assert from "node:assert/strict";
import { KnowledgeCache } from "../cache.js";

// ── Basic get/set ────────────────────────────────────────────────────────────

test("KnowledgeCache: stores and retrieves a value", () => {
  const cache = new KnowledgeCache<string>(60_000);
  cache.set("key", "value");
  assert.equal(cache.get("key"), "value");
});

test("KnowledgeCache: returns undefined for missing key", () => {
  const cache = new KnowledgeCache<string>(60_000);
  assert.equal(cache.get("missing"), undefined);
});

test("KnowledgeCache: has() returns true for live entry", () => {
  const cache = new KnowledgeCache<number>(60_000);
  cache.set("n", 42);
  assert.ok(cache.has("n"));
});

test("KnowledgeCache: has() returns false for missing key", () => {
  const cache = new KnowledgeCache<number>(60_000);
  assert.equal(cache.has("nope"), false);
});

// ── TTL / expiry ─────────────────────────────────────────────────────────────

test("KnowledgeCache: expired entry returns undefined from get()", async () => {
  const cache = new KnowledgeCache<string>(10); // 10 ms TTL
  cache.set("k", "v");
  await new Promise<void>((r) => setTimeout(r, 30)); // wait for expiry
  assert.equal(cache.get("k"), undefined);
});

test("KnowledgeCache: getStale() returns expired value", async () => {
  const cache = new KnowledgeCache<string>(10);
  cache.set("k", "v");
  await new Promise<void>((r) => setTimeout(r, 30));
  assert.equal(cache.getStale("k"), "v");
});

test("KnowledgeCache: hasStale() true even after expiry", async () => {
  const cache = new KnowledgeCache<string>(10);
  cache.set("k", "v");
  await new Promise<void>((r) => setTimeout(r, 30));
  assert.ok(cache.hasStale("k"));
  assert.equal(cache.has("k"), false);
});

test("KnowledgeCache: TTL=0 means no expiry", async () => {
  const cache = new KnowledgeCache<string>(0);
  cache.set("k", "persistent");
  await new Promise<void>((r) => setTimeout(r, 30));
  assert.equal(cache.get("k"), "persistent");
});

// ── Invalidation ─────────────────────────────────────────────────────────────

test("KnowledgeCache: delete() removes specific key", () => {
  const cache = new KnowledgeCache<string>(60_000);
  cache.set("a", "1");
  cache.set("b", "2");
  cache.delete("a");
  assert.equal(cache.get("a"), undefined);
  assert.equal(cache.get("b"), "2");
});

test("KnowledgeCache: deleteByPrefix() removes all matching keys", () => {
  const cache = new KnowledgeCache<string>(60_000);
  cache.set("/home/user:src", "a");
  cache.set("/home/user:doc", "b");
  cache.set("/tmp:src", "c");
  cache.deleteByPrefix("/home/user");
  assert.equal(cache.get("/home/user:src"), undefined);
  assert.equal(cache.get("/home/user:doc"), undefined);
  assert.equal(cache.get("/tmp:src"), "c");
});

test("KnowledgeCache: clear() removes all entries", () => {
  const cache = new KnowledgeCache<number>(60_000);
  cache.set("a", 1);
  cache.set("b", 2);
  cache.clear();
  assert.equal(cache.size(), 0);
});

// ── Size / values ─────────────────────────────────────────────────────────────

test("KnowledgeCache: size() counts only live entries", async () => {
  const cache = new KnowledgeCache<number>(10);
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.size(), 2);
  await new Promise<void>((r) => setTimeout(r, 30));
  assert.equal(cache.size(), 0);
});

test("KnowledgeCache: values() returns all live values", () => {
  const cache = new KnowledgeCache<number>(60_000);
  cache.set("x", 10);
  cache.set("y", 20);
  const vals = cache.values().sort((a, b) => a - b);
  assert.deepEqual(vals, [10, 20]);
});

// ── CWD-keyed isolation ───────────────────────────────────────────────────────

test("KnowledgeCache: CWD-keyed entries are isolated", () => {
  const cache = new KnowledgeCache<string[]>(60_000);
  cache.set("/home/user:De", ["Desktop/"]);
  cache.set("/tmp:De", ["dev/"]);
  assert.deepEqual(cache.get("/home/user:De"), ["Desktop/"]);
  assert.deepEqual(cache.get("/tmp:De"), ["dev/"]);
});
