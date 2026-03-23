// src/cache/PaymentsCache.js
// Caching layer for payments data using both in-memory storage and
// localStorage with a configurable TTL.

import Logger from '../utils/logger.js';

const DEFAULT_TTL_MS = 90 * 1000; // ~90 seconds
const STORAGE_PREFIX = 'payments.cache.';

/**
 * PaymentsCache provides a simple key/value cache with TTL semantics.
 * It stores data in-memory for fast access and in localStorage for resilience
 * across page reloads, when available.
 */
export class PaymentsCache {
  /** @type {PaymentsCache | null} */
  static #instance = null;

  /**
   * @param {Object} [options]
   * @param {number} [options.ttlMs] - Default time-to-live for cache entries in ms.
   * @param {Storage|null} [options.storage] - The storage implementation to use for persistence.
   */
  constructor({ ttlMs = DEFAULT_TTL_MS, storage = null } = {}) {
    this.ttlMs = ttlMs;
    this.memory = new Map(); // key -> { data, expiresAt, cachedAt }

    // Detect localStorage support safely.
    this.storage = storage || this.#detectStorage();
  }

  static getInstance() {
    if (!PaymentsCache.#instance) {
      PaymentsCache.#instance = new PaymentsCache();
    }
    return PaymentsCache.#instance;
  }

  #detectStorage() {
    try {
      if (typeof window === 'undefined' || !window.localStorage) {
        return null;
      }
      const testKey = '__payments_cache_test__';
      window.localStorage.setItem(testKey, '1');
      window.localStorage.removeItem(testKey);
      return window.localStorage;
    } catch (err) {
      Logger.warn('LocalStorage is not available, falling back to in-memory cache only.', err);
      return null;
    }
  }

  #storageKey(key) {
    return `${STORAGE_PREFIX}${key}`;
  }

  /**
   * Internal get that optionally allows returning stale data.
   * @param {string} key
   * @param {boolean} allowStale
   * @returns {any | null}
   */
  #getInternal(key, allowStale) {
    const now = Date.now();

    // 1. Check in-memory cache first.
    const memEntry = this.memory.get(key);
    if (memEntry) {
      if (!allowStale && now > memEntry.expiresAt) {
        // Expired; clean up memory and storage.
        this.memory.delete(key);
        this.#removeFromStorage(key);
      } else {
        return memEntry.data;
      }
    }

    // 2. Fallback to persistent storage.
    if (!this.storage) {
      return null;
    }

    try {
      const raw = this.storage.getItem(this.#storageKey(key));
      if (!raw) {
        return null;
      }
      const entry = JSON.parse(raw);
      if (!entry || typeof entry !== 'object') {
        this.storage.removeItem(this.#storageKey(key));
        return null;
      }

      const { data, expiresAt, cachedAt } = entry;
      if (!allowStale && typeof expiresAt === 'number' && now > expiresAt) {
        // Expired on disk.
        this.storage.removeItem(this.#storageKey(key));
        return null;
      }

      // Rehydrate in-memory cache for faster subsequent reads.
      if (typeof expiresAt === 'number') {
        this.memory.set(key, { data, expiresAt, cachedAt: cachedAt || now });
      }
      return data;
    } catch (err) {
      Logger.warn('Failed to read from localStorage cache, ignoring persisted entry.', err);
      return null;
    }
  }

  #removeFromStorage(key) {
    if (!this.storage) return;
    try {
      this.storage.removeItem(this.#storageKey(key));
    } catch (err) {
      Logger.warn('Failed to remove cache entry from localStorage.', err);
    }
  }

  /**
   * Retrieve a cache entry only if it has not expired.
   * @param {string} key
   * @returns {any | null}
   */
  getValid(key) {
    return this.#getInternal(key, false);
  }

  /**
   * Retrieve a cache entry even if it has expired. This is useful for
   * error fallback scenarios where slightly stale data is preferable to none.
   * @param {string} key
   * @returns {any | null}
   */
  getStale(key) {
    return this.#getInternal(key, true);
  }

  /**
   * Set a value in the cache for a given key.
   * @param {string} key
   * @param {any} data - JSON-serializable data to cache.
   * @param {number} [ttlMs]
   */
  set(key, data, ttlMs = this.ttlMs) {
    const now = Date.now();
    const expiresAt = now + ttlMs;
    const entry = { data, expiresAt, cachedAt: now };

    // In-memory
    this.memory.set(key, entry);

    // Persistent
    if (this.storage) {
      try {
        this.storage.setItem(this.#storageKey(key), JSON.stringify(entry));
      } catch (err) {
        // Storage quota issues or others should not break the app.
        Logger.warn('Failed to persist payments cache entry to localStorage.', err);
      }
    }
  }

  /**
   * Remove a specific cache entry.
   * @param {string} key
   */
  clear(key) {
    this.memory.delete(key);
    this.#removeFromStorage(key);
  }

  /**
   * Clear all cache entries managed by this cache instance.
   */
  clearAll() {
    this.memory.clear();
    if (!this.storage) return;

    try {
      const keysToRemove = [];
      for (let i = 0; i < this.storage.length; i++) {
        const storageKey = this.storage.key(i);
        if (storageKey && storageKey.startsWith(STORAGE_PREFIX)) {
          keysToRemove.push(storageKey);
        }
      }
      keysToRemove.forEach((k) => this.storage.removeItem(k));
    } catch (err) {
      Logger.warn('Failed to clear payments entries from localStorage.', err);
    }
  }
}

export default PaymentsCache;
