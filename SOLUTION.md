# Solution Steps

1. Create a new `utils/logger.js` module that wraps `console` calls in a `Logger` object (`debug`, `info`, `warn`, `error`) and safely no-ops if `console` is unavailable. Export `Logger` as the default so the rest of the codebase can depend on a single logging abstraction.

2. Implement a `cache/PaymentsCache.js` module that manages a combined in-memory and `localStorage` cache with TTL semantics:
- Store entries in a `Map` in memory with shape `{ data, expiresAt, cachedAt }`.
- Detect whether `localStorage` is usable inside the constructor using a small read/write test wrapped in `try/catch`; fall back to in-memory-only if not.
- Define a storage key prefix like `payments.cache.` so payments cache entries are namespaced.
- Implement a private `#getInternal(key, allowStale)` method that first checks in-memory entries, validates TTL when `allowStale` is `false`, and then, on miss, checks `localStorage` (re-hydrating the in-memory map when a valid entry is found).
- Implement `getValid(key)` to call `#getInternal(key, false)` and return only non-expired data.
- Implement `getStale(key)` to call `#getInternal(key, true)` and return data even if expired (used for error fallback).
- Implement `set(key, data, ttlMs)` that computes `expiresAt = Date.now() + ttlMs`, stores the entry in memory, and persists it to `localStorage` via `JSON.stringify`, catching and logging any persistence errors.
- Implement `clear(key)` to remove the entry from memory and `localStorage`, and `clearAll()` to delete all keys in storage with the payments prefix.

3. Create an `api/PaymentsApi.js` module to encapsulate all network calls and caching for the payments dashboard:
- Define constants for the endpoints (`/api/payments/daily` and `/api/payments/monthly`) and a default TTL of ~90 seconds.
- Implement a singleton `PaymentsApi` class with a static `getInstance()` method and a constructor that accepts a `PaymentsCache` instance and a `fetchImpl` dependency for easier testing.
- Add a private method `#buildCacheKey(startDate, endDate)` that returns a unique key like `"start-end"` for cache lookup.
- Add a private method `#buildUrl(endpoint, startDate, endDate)` that uses `new URL()` with `window.location.origin` to construct a fully-qualified URL with `start` and `end` query parameters.
- Implement a small `AuthTokenError` class to distinguish auth failures.
- Add `#getAuthHeader()` to read the JWT from `sessionStorage` under key `"jwtToken"`, wrapped in `try/catch`; on failure or missing token, log the problem and throw an `AuthTokenError` so the caller can handle it cleanly.
- Implement `#fetchJson(url, options, timeoutMs)` that uses `fetch` with an `AbortController` to enforce a timeout, throws an error on non-OK HTTP status (optionally logging the text body), and returns parsed JSON.
- Implement `loadPaymentsBundle({ startDate, endDate })` that validates inputs, computes a cache key, checks `cache.getValid(key)` first, and if found returns the cached bundle annotated with `meta: { source: 'cache', stale: false }`.
- If no valid cache is found, build the `Authorization` header from `#getAuthHeader()`, prepare common headers, build URLs for both daily and monthly endpoints, then fetch both concurrently using `Promise.all` and `#fetchJson`.
- On successful network responses, create a bundle object `{ daily, monthly, fetchedAt: new Date().toISOString() }`, store it in the cache with the configured TTL, log the load duration, and return the bundle along with `meta: { source: 'network', stale: false }`.
- Wrap the concurrent fetches in `try/catch`; in the `catch` block, attempt `cache.getStale(cacheKey)`, and if found return that bundle with `meta: { source: 'cache-fallback', stale: true }`; if no cache is available, rethrow the original error so the UI can display a user-friendly message.

4. Design a `ui/PaymentsDashboard.js` module to own the browser-facing behavior and DOM interactions:
- Define a `PaymentsDashboard` class that is constructed with a `paymentsApi` instance and optional DOM selector overrides.
- In the constructor, store selectors for root, start-date input, end-date input, load button, daily results container, monthly results container, error banner, and last-updated label, with sensible defaults like `#payments-start-date` and `#payments-daily`.
- Implement an `init()` method that calls a private `#cacheDom()` helper to resolve all selectors via `document.querySelector` and a private `#bindEvents()` helper to wire up the click handler on the Load button.
- In `#cacheDom()`, store references to each DOM node in a `dom` object and set ARIA attributes (`role="alert"`, `aria-live="polite"`) on the error banner to improve accessibility.
- In `#bindEvents()`, attach a click listener to the Load button that calls `loadPaymentsForCurrentRange()` and logs a warning if the button is not found so initialization never hard-crashes.
- Implement `loadPaymentsForCurrentRange()` as an `async` method that reads the current start and end dates from the inputs, validates they are present and that `start <= end`, and on invalid input shows a specific error message and returns early.
- When input is valid, clear any existing error, set a loading state on the button (disable it, change its text to "Loading…", set `aria-busy`, and toggle a CSS class like `is-loading`), then call `paymentsApi.loadPaymentsBundle({ startDate, endDate })` inside a `try/catch/finally` block.
- On success, pass the returned bundle into a private `#renderBundle(bundle)` method; on error, log via `Logger.error` and show the generic user-facing message "Failed to load payments. Please try again later." while leaving any prior data visible; in `finally`, always clear the loading state on the button.
- Implement `#showError(message)` and `#clearError()` that update the error banner text and visibility within `requestAnimationFrame` to batch DOM updates and avoid layout thrashing.
- Implement `#renderBundle({ daily, monthly, fetchedAt, meta })` that:
  - Uses a small helper `renderJsonInto(container, data, emptyMessage)` to clear the container, then either set an empty state message or append a single `<pre>` element whose `textContent` is `JSON.stringify(data, null, 2)`, ensuring only one update per container.
  - Computes a label for the last-updated element like `"Last updated: <local time>"` and appends `" (from cache)"` when `meta.stale` is true.
  - Uses `requestAnimationFrame` to update both the daily and monthly containers and the last-updated label in one render pass, minimizing reflows and flicker.
- Make sure `#renderBundle` checks for missing DOM containers and logs a warning instead of throwing, to keep the rest of the page functioning even if markup changes.

5. Implement a top-level `index.js` as the dashboard entry point:
- Import `PaymentsApi`, `PaymentsDashboard`, and the `Logger`.
- Define a `bootstrapPaymentsDashboard()` function that instantiates the singleton `PaymentsApi`, creates a `PaymentsDashboard` with that API, calls `dashboard.init()`, and logs a successful initialization.
- Wrap the bootstrap call in a `try/catch` so any unexpected initialization errors are logged via `Logger.error` rather than breaking the entire page.
- Attach `bootstrapPaymentsDashboard` to the `DOMContentLoaded` event when `document.readyState` is `loading`, or call it immediately if the DOM is already ready.
- Optionally expose the dashboard instance on `window.__paymentsDashboard` to ease manual testing in the browser console without affecting production behavior.

6. Wire the modules together and verify behavior end-to-end:
- Ensure your bundler or script tags load `index.js` as an ES module so that `import` statements work in the browser.
- Confirm that when the user selects a date range and clicks Load, daily and monthly endpoints are requested concurrently with a single, consistent `Authorization: Bearer <token>` header sourced from `sessionStorage`.
- Confirm that repeated clicking with the same date range within ~90 seconds returns immediately without new network requests (served from `PaymentsCache`).
- Simulate network failures (e.g., by disabling the network tab in dev tools) and verify that, when cache data exists, the dashboard continues to render that stale data with the last-updated label indicating it came from cache; if no cache exists, verify that the error banner shows the friendly failure message while the rest of the page remains interactive.
- Observe the DOM updates when loading data: the Load button should show a clear loading state, the containers should update without excessive flicker, and logs should appear in the console reflecting cache hits, network durations, and error conditions.

