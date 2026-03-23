// src/ui/PaymentsDashboard.js
// Presentation/controller layer for the payments dashboard.
// Wires up DOM events, orchestrates data loading via PaymentsApi,
// and updates the UI with minimal layout thrashing.

import Logger from '../utils/logger.js';

export class PaymentsDashboard {
  /**
   * @param {Object} options
   * @param {import('../api/PaymentsApi.js').PaymentsApi} options.paymentsApi
   * @param {Object} [options.selectors]
   */
  constructor({ paymentsApi, selectors = {} }) {
    if (!paymentsApi) {
      throw new Error('paymentsApi is required to initialize PaymentsDashboard.');
    }

    this.paymentsApi = paymentsApi;

    // Allow selectors to be overridden for testing.
    this.selectors = {
      root: selectors.root || '#payments-dashboard',
      startInput: selectors.startInput || '#payments-start-date',
      endInput: selectors.endInput || '#payments-end-date',
      loadButton: selectors.loadButton || '#payments-load-btn',
      dailyContainer: selectors.dailyContainer || '#payments-daily',
      monthlyContainer: selectors.monthlyContainer || '#payments-monthly',
      errorBanner: selectors.errorBanner || '#payments-error-banner',
      lastUpdated: selectors.lastUpdated || '#payments-last-updated',
    };

    this.dom = {
      root: null,
      startInput: null,
      endInput: null,
      loadButton: null,
      dailyContainer: null,
      monthlyContainer: null,
      errorBanner: null,
      lastUpdated: null,
    };

    this._originalLoadButtonText = '';
  }

  /**
   * Initialize the dashboard: cache DOM references and bind events.
   */
  init() {
    this.#cacheDom();
    this.#bindEvents();
  }

  #cacheDom() {
    const q = (sel) => (typeof document !== 'undefined' ? document.querySelector(sel) : null);

    this.dom.root = q(this.selectors.root);
    this.dom.startInput = q(this.selectors.startInput);
    this.dom.endInput = q(this.selectors.endInput);
    this.dom.loadButton = q(this.selectors.loadButton);
    this.dom.dailyContainer = q(this.selectors.dailyContainer);
    this.dom.monthlyContainer = q(this.selectors.monthlyContainer);
    this.dom.errorBanner = q(this.selectors.errorBanner);
    this.dom.lastUpdated = q(this.selectors.lastUpdated);

    if (this.dom.errorBanner) {
      this.dom.errorBanner.setAttribute('role', 'alert');
      this.dom.errorBanner.setAttribute('aria-live', 'polite');
    }
  }

  #bindEvents() {
    if (!this.dom.loadButton) {
      Logger.warn('PaymentsDashboard: Load button not found in DOM; UI will be read-only.');
      return;
    }

    this.dom.loadButton.addEventListener('click', (event) => {
      event.preventDefault();
      this.loadPaymentsForCurrentRange();
    });
  }

  /**
   * Public method to trigger loading based on the currently selected date range.
   */
  async loadPaymentsForCurrentRange() {
    const startDate = this.dom.startInput ? this.dom.startInput.value : '';
    const endDate = this.dom.endInput ? this.dom.endInput.value : '';

    if (!startDate || !endDate) {
      this.#showError('Please select both start and end dates.');
      return;
    }

    if (startDate > endDate) {
      this.#showError('Start date must be before or equal to end date.');
      return;
    }

    this.#clearError();
    this.#setLoading(true);

    try {
      const bundle = await this.paymentsApi.loadPaymentsBundle({ startDate, endDate });
      await this.#renderBundle(bundle);
    } catch (err) {
      Logger.error('PaymentsDashboard: Failed to load payments.', err);
      this.#showError('Failed to load payments. Please try again later.');
      // Leave existing data on screen for continuity.
    } finally {
      this.#setLoading(false);
    }
  }

  #setLoading(isLoading) {
    const btn = this.dom.loadButton;
    if (!btn) return;

    if (this._originalLoadButtonText === '') {
      this._originalLoadButtonText = btn.textContent || 'Load';
    }

    btn.disabled = isLoading;
    btn.setAttribute('aria-busy', String(isLoading));

    if (isLoading) {
      btn.textContent = 'Loading…';
      btn.classList.add('is-loading');
    } else {
      btn.textContent = this._originalLoadButtonText;
      btn.classList.remove('is-loading');
    }
  }

  #showError(message) {
    const banner = this.dom.errorBanner;
    if (!banner) {
      Logger.warn('PaymentsDashboard: Error banner element not found.', { message });
      return;
    }

    // Batch DOM updates to minimize layout thrashing.
    window.requestAnimationFrame(() => {
      banner.textContent = message;
      banner.style.display = 'block';
    });
  }

  #clearError() {
    const banner = this.dom.errorBanner;
    if (!banner) return;

    window.requestAnimationFrame(() => {
      banner.textContent = '';
      banner.style.display = 'none';
    });
  }

  async #renderBundle(bundle) {
    const { daily, monthly, fetchedAt, meta } = bundle;

    const dailyContainer = this.dom.dailyContainer;
    const monthlyContainer = this.dom.monthlyContainer;

    if (!dailyContainer || !monthlyContainer) {
      Logger.warn('PaymentsDashboard: One or more result containers are missing from the DOM.');
      return;
    }

    // Render using JSON <pre> blocks to avoid strong assumptions about
    // the exact shape of the API responses and to minimize DOM writes.
    const renderJsonInto = (container, data, emptyMessage) => {
      container.textContent = '';

      if (data == null) {
        container.textContent = emptyMessage;
        return;
      }

      // Single append -> single layout pass.
      const pre = document.createElement('pre');
      pre.textContent = JSON.stringify(data, null, 2);
      container.appendChild(pre);
    };

    const lastUpdatedLabel = this.dom.lastUpdated;
    const labelText = fetchedAt
      ? `Last updated: ${new Date(fetchedAt).toLocaleString()}${meta && meta.stale ? ' (from cache)' : ''}`
      : '';

    // Use requestAnimationFrame to batch all DOM mutations together.
    await new Promise((resolve) => {
      window.requestAnimationFrame(() => {
        renderJsonInto(dailyContainer, daily, 'No daily payments for this range.');
        renderJsonInto(monthlyContainer, monthly, 'No monthly payments for this range.');

        if (lastUpdatedLabel) {
          lastUpdatedLabel.textContent = labelText;
        }

        resolve();
      });
    });
  }
}

export default PaymentsDashboard;
