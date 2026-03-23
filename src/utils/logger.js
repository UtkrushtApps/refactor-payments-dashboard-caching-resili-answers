// src/utils/logger.js
// Simple, centralized logger abstraction for the payments dashboard.
// This makes it easy to swap out or augment logging in the future
// (e.g. sending logs to a remote observability service).

const isConsoleAvailable = typeof console !== 'undefined';

const noop = () => {};

/**
 * Logger with level-based methods. In a real-world app this could
 * include correlation IDs, user IDs, etc.
 */
export const Logger = {
  debug: isConsoleAvailable && console.debug ? console.debug.bind(console) : noop,
  info: isConsoleAvailable && console.info ? console.info.bind(console) : noop,
  warn: isConsoleAvailable && console.warn ? console.warn.bind(console) : noop,
  error: isConsoleAvailable && console.error ? console.error.bind(console) : noop,
};

export default Logger;
