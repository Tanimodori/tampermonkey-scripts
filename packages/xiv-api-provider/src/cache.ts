/**
 * Promise memoization with the two properties `xivanalysis-zh/src/translate/useCache.ts` lacks.
 *
 * That helper caches the promise before it settles and never removes it, so a single failed request
 * poisons the key for the lifetime of the page: every later lookup hands back the same rejected promise
 * and the icon or name stays untranslated even after the network recovers. It also grows without bound.
 *
 * This version evicts a rejection so the next call retries, and bounds the entry count.
 */

export interface Memo<K, V> {
  /** Exposed so a caller can inspect or clear it; `useCache` consumers already lean on this. */
  readonly cache: Map<K, Promise<V>>;
  readonly get: (key: K) => Promise<V>;
  readonly has: (key: K) => boolean;
  readonly delete: (key: K) => boolean;
  readonly clear: () => void;
  readonly size: () => number;
}

export interface MemoOptions {
  /**
   * Entries kept before the oldest is dropped. Sized for one screen of a market listing or a timeline,
   * which is what the two userscripts actually accumulate; a page that reads tens of thousands of items
   * will thrash rather than grow without bound.
   */
  readonly max?: number;
}

const DEFAULT_MAX = 500;

export const createMemo = <K, V>(loader: (key: K) => Promise<V>, options: MemoOptions = {}): Memo<K, V> => {
  const max = options.max ?? DEFAULT_MAX;
  const cache = new Map<K, Promise<V>>();

  const evictOldestIfNeeded = (): void => {
    while (cache.size >= max) {
      const oldest = cache.keys().next();
      if (oldest.done === true) return;
      cache.delete(oldest.value);
    }
  };

  const get = (key: K): Promise<V> => {
    const existing = cache.get(key);
    if (existing !== undefined) return existing;

    evictOldestIfNeeded();
    const pending = loader(key);
    cache.set(key, pending);

    // Hand back the same promise to concurrent callers, but drop the entry if it fails. The handler
    // returns the rejection unchanged, so a caller that catches still sees the original error.
    pending.catch(() => {
      if (cache.get(key) === pending) cache.delete(key);
    });

    return pending;
  };

  return {
    cache,
    get,
    has: (key) => cache.has(key),
    delete: (key) => cache.delete(key),
    clear: () => cache.clear(),
    size: () => cache.size,
  };
};
