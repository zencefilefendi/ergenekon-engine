// ============================================================================
// ERGENEKON PROBE — Error & Console Interceptors
//
// Captures uncaught exceptions, unhandled rejections, and console output.
// These are critical for debugging — when something crashes in production,
// ERGENEKON records exactly what happened, including the full stack trace
// and the console output leading up to the crash.
// ============================================================================

import { getActiveSession } from '../recording-context.js';
import { originalDateNow } from '../internal-clock.js';

let installed = false;

const _originalConsoleLog = console.log;
const _originalConsoleWarn = console.warn;
const _originalConsoleError = console.error;

let uncaughtHandler: ((err: Error) => void) | null = null;
let rejectionHandler: ((reason: unknown, promise: Promise<unknown>) => void) | null = null;

/**
 * Install error and console interceptors.
 */
export function installErrorInterceptors(): void {
  if (installed) return;
  installed = true;

  // ── uncaughtException ───────────────────────────────────────────

  uncaughtHandler = (err: Error) => {
    const session = getActiveSession();
    if (session) {
      session.record('error', `UNCAUGHT: ${err.message}`, {
        type: 'uncaughtException',
        name: err.name,
        message: err.message,
        stack: err.stack ?? null,
      }, {
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack ?? null,
        },
      });
    }
  };
  process.on('uncaughtException', uncaughtHandler);

  // ── unhandledRejection ──────────────────────────────────────────

  rejectionHandler = (reason: unknown) => {
    const session = getActiveSession();
    if (session) {
      const err = reason instanceof Error ? reason : new Error(String(reason));
      session.record('error', `UNHANDLED REJECTION: ${err.message}`, {
        type: 'unhandledRejection',
        name: err.name,
        message: err.message,
        stack: err.stack ?? null,
      }, {
        error: {
          name: err.name,
          message: err.message,
          stack: err.stack ?? null,
        },
      });
    }
  };
  process.on('unhandledRejection', rejectionHandler);

  // ── console.log/warn/error ──────────────────────────────────────

  console.log = function paradoxConsoleLog(...args: unknown[]): void {
    const session = getActiveSession();
    if (session) {
      session.record('custom', 'console.log', {
        level: 'log',
        args: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)),
        timestamp: originalDateNow(),
      });
    }
    return _originalConsoleLog.apply(console, args);
  };

  console.warn = function paradoxConsoleWarn(...args: unknown[]): void {
    const session = getActiveSession();
    if (session) {
      session.record('custom', 'console.warn', {
        level: 'warn',
        args: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)),
        timestamp: originalDateNow(),
      });
    }
    return _originalConsoleWarn.apply(console, args);
  };

  console.error = function paradoxConsoleError(...args: unknown[]): void {
    const session = getActiveSession();
    if (session) {
      session.record('custom', 'console.error', {
        level: 'error',
        args: args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)),
        timestamp: originalDateNow(),
      });
    }
    return _originalConsoleError.apply(console, args);
  };
}

/**
 * Uninstall error and console interceptors.
 */
export function uninstallErrorInterceptors(): void {
  if (!installed) return;
  installed = false;

  if (uncaughtHandler) {
    process.removeListener('uncaughtException', uncaughtHandler);
    uncaughtHandler = null;
  }

  if (rejectionHandler) {
    process.removeListener('unhandledRejection', rejectionHandler);
    rejectionHandler = null;
  }

  console.log = _originalConsoleLog;
  console.warn = _originalConsoleWarn;
  console.error = _originalConsoleError;
}
