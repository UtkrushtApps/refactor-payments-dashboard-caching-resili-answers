// src/index.js
// Entry point for the payments dashboard front-end logic.

import PaymentsApi from './api/PaymentsApi.js';
import PaymentsDashboard from './ui/PaymentsDashboard.js';
import Logger from './utils/logger.js';

function bootstrapPaymentsDashboard() {
  try {
    const api = PaymentsApi.getInstance();
    const dashboard = new PaymentsDashboard({ paymentsApi: api });
    dashboard.init();
    Logger.info('Payments dashboard initialized.');

    // Optionally expose for manual debugging / testing in the console.
    if (typeof window !== 'undefined') {
      window.__paymentsDashboard = dashboard; // eslint-disable-line no-underscore-dangle
    }
  } catch (err) {
    Logger.error('Failed to initialize payments dashboard.', err);
  }
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapPaymentsDashboard);
  } else {
    bootstrapPaymentsDashboard();
  }
}

export default bootstrapPaymentsDashboard;
