/**
 * Local Knowledge Cache
 *
 * A typed, TTL-based cache with:
 *   - CWD-keyed slots (filesystem / git / project data keyed by directory)
 *   - Global slots (PATH commands)
 *   - Explicit invalidation by scope
 *   - Stale-while-revalidate: returns stale data while async refresh runs
 *
 * No external dependencies. Runs entirely in-process.
 */

type CacheEntry<T> = {
  value: T;
  storedAt: number;
  ttlMs: number;
};

function isExpired<T>(entry: CacheEntry<T>): boolean {
  return Date.now() - entry.storedAt > entry.ttlMs;
}

/**
 * Generic key→value TTL cache with explicit invalidation.
 */
export class KnowledgeCache<T> {
  private readonly store = new Map<string, CacheEntry<T>>();

  /**
   * @param defaultTtlMs  Default TTL in milliseconds (0 = no expiry)
   */
  constructor(private readonly defaultTtlMs: number) {}

  /** Store a value under key with optional custom TTL. */
  set(key: string, value: T, ttlMs?: number): void {
    this.store.set(key, {
      value,
      storedAt: Date.now(),
      ttlMs: ttlMs ?? this.defaultTtlMs,
    });
  }

  /**
   * Get a cached value.
   * Returns `undefined` if missing or expired.
   */
  get(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.defaultTtlMs > 0 && isExpired(entry)) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  /**
   * Get stale value even if expired.
   * Useful for stale-while-revalidate pattern.
   */
  getStale(key: string): T | undefined {
    return this.store.get(key)?.value;
  }

  /** True if key exists and has NOT expired. */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /** True if key exists, even if expired (stale). */
  hasStale(key: string): boolean {
    return this.store.has(key);
  }

  /** Remove a specific key. */
  delete(key: string): void {
    this.store.delete(key);
  }

  /** Remove all keys with the given prefix. Useful for "invalidate /home/user/*". */
  deleteByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }

  /** Clear everything. */
  clear(): void {
    this.store.clear();
  }

  /** Number of non-expired entries. */
  size(): number {
    let count = 0;
    for (const [, entry] of this.store) {
      if (this.defaultTtlMs === 0 || !isExpired(entry)) count++;
    }
    return count;
  }

  /** All non-expired values. */
  values(): T[] {
    const result: T[] = [];
    for (const [, entry] of this.store) {
      if (this.defaultTtlMs === 0 || !isExpired(entry)) result.push(entry.value);
    }
    return result;
  }
}
