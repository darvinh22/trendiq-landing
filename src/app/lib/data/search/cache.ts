export interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface SearchCache<T> {
  get(key: string, now?: number): T | undefined;
  set(key: string, value: T, ttlMs: number, now?: number): void;
  clear(): void;
}

export class InMemorySearchCache<T> implements SearchCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  get(key: string, now = Date.now()): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;

    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }

    return entry.value;
  }

  set(key: string, value: T, ttlMs: number, now = Date.now()): void {
    this.entries.set(key, {
      value,
      expiresAt: now + ttlMs,
    });
  }

  clear(): void {
    this.entries.clear();
  }
}
