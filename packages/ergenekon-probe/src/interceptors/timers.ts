// ============================================================================
// ERGENEKON PROBE — Timer & Crypto Interceptors
//
// Captures: setTimeout, setInterval, crypto.randomUUID
//
// Timer interception is tricky: we don't replace the timer mechanism,
// we just record WHEN timers are set and WHEN they fire.
// For replay, the mock layer will fire them in the recorded order.
// ============================================================================

import { getActiveSession } from '../recording-context.js';
import { originalDateNow } from '../internal-clock.js';

let installed = false;

const _originalSetTimeout = globalThis.setTimeout;
const _originalSetInterval = globalThis.setInterval;
const _originalClearTimeout = globalThis.clearTimeout;
const _originalClearInterval = globalThis.clearInterval;

let _originalRandomUUID: (() => string) | null = null;

// Track timer IDs to correlate set/fire events
const _timerMap = new WeakMap<object, { timerId: string, type: string }>();
let timerCounter = 0;

/**
 * Install timer and crypto interceptors.
 */
export function installTimerInterceptors(): void {
  if (installed) return;
  installed = true;

  // ── setTimeout ──────────────────────────────────────────────────

  globalThis.setTimeout = function ergenekonSetTimeout(
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ): ReturnType<typeof setTimeout> {
    const session = getActiveSession();
    if (!session) return _originalSetTimeout(callback, ms, ...args);

    const timerId = `timer_${++timerCounter}`;
    const delay = ms ?? 0;

    session.record('timer_set', `setTimeout(${delay}ms)`, {
      timerId,
      delay,
      type: 'timeout',
    });

    const wrappedCallback = (...cbArgs: unknown[]) => {
      const activeSession = getActiveSession();
      if (activeSession) {
        activeSession.record('timer_fire', `setTimeout fired (${delay}ms)`, {
          timerId,
          delay,
          type: 'timeout',
          firedAt: originalDateNow(),
        });
      }
      return callback(...cbArgs);
    };

    const timer = _originalSetTimeout(wrappedCallback, ms, ...args);
    if (timer && typeof timer === 'object') {
      _timerMap.set(timer, { timerId, type: 'timeout' });
    }
    return timer;
  } as typeof globalThis.setTimeout;

  // ── setInterval ─────────────────────────────────────────────────

  globalThis.setInterval = function ergenekonSetInterval(
    callback: (...args: unknown[]) => void,
    ms?: number,
    ...args: unknown[]
  ): ReturnType<typeof setInterval> {
    const session = getActiveSession();
    if (!session) return _originalSetInterval(callback, ms, ...args);

    const timerId = `interval_${++timerCounter}`;
    const delay = ms ?? 0;

    session.record('timer_set', `setInterval(${delay}ms)`, {
      timerId,
      delay,
      type: 'interval',
    });

    let fireCount = 0;
    const wrappedCallback = (...cbArgs: unknown[]) => {
      const activeSession = getActiveSession();
      if (activeSession) {
        activeSession.record('timer_fire', `setInterval fired #${++fireCount} (${delay}ms)`, {
          timerId,
          delay,
          type: 'interval',
          fireCount,
          firedAt: originalDateNow(),
        });
      }
      return callback(...cbArgs);
    };

    const timer = _originalSetInterval(wrappedCallback, ms, ...args);
    if (timer && typeof timer === 'object') {
      _timerMap.set(timer, { timerId, type: 'interval' });
    }
    return timer;
  } as typeof globalThis.setInterval;

  // ── clearTimeout ────────────────────────────────────────────────
  
  globalThis.clearTimeout = function ergenekonClearTimeout(timerId?: string | number | NodeJS.Timeout | undefined) {
    if (timerId && typeof timerId === 'object') {
      const meta = _timerMap.get(timerId);
      const session = getActiveSession();
      if (meta && session) {
        session.record('timer_clear', `clearTimeout`, meta);
      }
    }
    return _originalClearTimeout(timerId);
  } as typeof globalThis.clearTimeout;

  // ── clearInterval ───────────────────────────────────────────────

  globalThis.clearInterval = function ergenekonClearInterval(timerId?: string | number | NodeJS.Timeout | undefined) {
    if (timerId && typeof timerId === 'object') {
      const meta = _timerMap.get(timerId);
      const session = getActiveSession();
      if (meta && session) {
        session.record('timer_clear', `clearInterval`, meta);
      }
    }
    return _originalClearInterval(timerId);
  } as typeof globalThis.clearInterval;

  // ── crypto.randomUUID ───────────────────────────────────────────

  try {
    const crypto = require('node:crypto');
    if (typeof crypto.randomUUID === 'function') {
      _originalRandomUUID = crypto.randomUUID.bind(crypto);

      // SECURITY: Replace property descriptor safely so ESM imports also get the patched UUID
      Object.defineProperty(crypto, 'randomUUID', {
        value: function ergenekonRandomUUID(): string {
          const value = _originalRandomUUID!();
          const session = getActiveSession();
          if (session) {
            session.record('uuid', 'crypto.randomUUID()', { value });
          }
          return value;
        },
        writable: true,
        configurable: true
      });
    }
  } catch {
    // crypto not available
  }
}

/**
 * Uninstall timer and crypto interceptors.
 */
export function uninstallTimerInterceptors(): void {
  if (!installed) return;
  installed = false;

  globalThis.setTimeout = _originalSetTimeout;
  globalThis.setInterval = _originalSetInterval;
  globalThis.clearTimeout = _originalClearTimeout;
  globalThis.clearInterval = _originalClearInterval;

  if (_originalRandomUUID) {
    try {
      const crypto = require('node:crypto');
      crypto.randomUUID = _originalRandomUUID;
    } catch { /* ignore */ }
  }
}
