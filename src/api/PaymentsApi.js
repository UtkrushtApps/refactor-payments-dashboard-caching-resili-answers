// src/api/PaymentsApi.js
// Singleton responsible for fetching combined daily + monthly payments
// bundles for a given date range, with concurrency, auth, and caching.

import PaymentsCache from '../cache/PaymentsCache.js';
import Logger from '../utils/logger.js';

const DAILY_ENDPOINT = '/api/payments/daily';
const MONTHLY_ENDPOINT = '/api/payments/monthly';
const CACHE_TTL_MS = 90 * 1000; // ~90 seconds

class AuthTokenError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AuthTokenError';
  }
}

export class PaymentsApi {
  /** @type {PaymentsApi | null} */
  static #instance = null;

  /**
   * @param {Object} [options]
   * @param {PaymentsCache} [options.cache]
   * @param {Function} [options.fetchImpl] - Dependency-injected `fetch` for easier testing.
   */
  constructor({ cache = PaymentsCache.getInstance(), fetchImpl = null } = {}) {
    this.cache = cache;
    this._fetchImpl = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(window) : null);

    if (!this._fetchImpl) {
      throw new Error('Fetch API is not available in this environment.');
    }
  }

  static getInstance() {
    if (!PaymentsApi.#instance) {
      PaymentsApi.#instance = new PaymentsApi();
    }
    return PaymentsApi.#instance;
  }

  /**
   * Build a consistent cache key from the date range.
   * @param {string} startDate
   * @param {string} endDate
   * @returns {string}
   */
  #buildCacheKey(startDate, endDate) {
    return `${startDate}-${endDate}`;
  }

  /**
   * Construct a fully-qualified URL with query params, relative to
   * the current origin.
   * @param {string} endpoint
   * @param {string} startDate
   * @param {string} endDate
   * @returns {string}
   */
  #buildUrl(endpoint, startDate, endDate) {
    const base = typeof window !== 'undefined' && window.location ? window.location.origin : '';
    const url = new URL(endpoint, base);
    url.searchParams.set('start', startDate);
    url.searchParams.set('end', endDate);
    return url.toString();
  }

  /**
   * Retrieve the JWT from sessionStorage and format the Authorization header.
   * @returns {string}
   */
  #getAuthHeader() {
    let token;
    try {
      if (typeof sessionStorage === 'undefined') {
        throw new Error('sessionStorage is not available');
      }
      token = sessionStorage.getItem('jwtToken');
    } catch (err) {
      Logger.error('Failed to read JWT token from sessionStorage.', err);
      throw new AuthTokenError('Authorization token is unavailable.');
    }

    if (!token) {
      throw new AuthTokenError('Authorization token is missing in sessionStorage (key: "jwtToken").');
    }

    return `Bearer ${token}`;
  }

  /**
   * Fetch JSON with a timeout for resilience.
   * @param {string} url
   * @param {Object} options
   * @param {number} [timeoutMs=15000]
   * @returns {Promise<any>}
   */
  async #fetchJson(url, options, timeoutMs = 15000) {
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const finalOptions = { ...options, signal: controller ? controller.signal : undefined };

    let timeoutId = null;
    if (controller) {
      timeoutId = setTimeout(() => {
        controller.abort();
      }, timeoutMs);
    }

    try {
      const response = await this._fetchImpl(url, finalOptions);

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`HTTP ${response.status} for ${url}: ${body}`);
      }

      return await response.json();
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs} ms for ${url}`);
      }
      throw err;
    } finally {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Load a combined payments bundle (daily + monthly) for the given date range.
   * Will consult the cache first, and fall back to network when needed.
   * If network fails, attempts to return stale cache data when available.
   *
   * @param {Object} params
   * @param {string} params.startDate - Inclusive start date (ISO yyyy-mm-dd).
   * @param {string} params.endDate - Inclusive end date (ISO yyyy-mm-dd).
   * @returns {Promise<{daily:any, monthly:any, fetchedAt:string, meta:{source:string, stale?:boolean}}>} 
   */
  async loadPaymentsBundle({ startDate, endDate }) {
    if (!startDate || !endDate) {
      throw new Error('Both startDate and endDate are required to load payments.');
    }

    const cacheKey = this.#buildCacheKey(startDate, endDate);

    // 1. Fast path: valid cache hit.
    const cached = this.cache.getValid(cacheKey);
    if (cached) {
      Logger.info('Serving payments bundle from valid cache.', { startDate, endDate });
      return {
        ...cached,
        meta: {
          source: 'cache',
          stale: false,
        },
      };
    }

    // 2. Network path: concurrent requests for daily + monthly.
    const authHeader = this.#getAuthHeader();
    const headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: authHeader,
    };

    const dailyUrl = this.#buildUrl(DAILY_ENDPOINT, startDate, endDate);
    const monthlyUrl = this.#buildUrl(MONTHLY_ENDPOINT, startDate, endDate);

    const startedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();

    try {
      const [daily, monthly] = await Promise.all([
        this.#fetchJson(dailyUrl, { method: 'GET', headers }),
        this.#fetchJson(monthlyUrl, { method: 'GET', headers }),
      ]);

      const fetchedAt = new Date().toISOString();
      const bundle = { daily, monthly, fetchedAt };

      // 3. Cache the combined bundle.
      this.cache.set(cacheKey, bundle, CACHE_TTL_MS);

      const finishedAt = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
      Logger.info('Loaded payments bundle from network.', {
        startDate,
        endDate,
        durationMs: finishedAt - startedAt,
      });

      return {
        ...bundle,
        meta: {
          source: 'network',
          stale: false,
        },
      };
    } catch (networkError) {
      Logger.error('Failed to load payments bundle from network.', networkError);

      // 4. Fallback: try stale cache data if available.
      const stale = this.cache.getStale(cacheKey);
      if (stale) {
        Logger.warn('Serving stale cached payments bundle due to network error.', {
          startDate,
          endDate,
        });
        return {
          ...stale,
          meta: {
            source: 'cache-fallback',
            stale: true,
          },
        };
      }

      // 5. Nothing usable – propagate error to caller for user-facing handling.
      throw networkError;
    }
  }
}

export default PaymentsApi;
