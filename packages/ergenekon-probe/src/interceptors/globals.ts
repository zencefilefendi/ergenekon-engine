// ============================================================================
// ERGENEKON PROBE — Global Interceptors
//
// Monkey-patches non-determinism sources: Date.now, Math.random, crypto
//
// KEY INSIGHT: An application is deterministic if all sources of
// non-determinism are captured. These globals are the "leaky faucets"
// that we must seal for perfect replay.
// ============================================================================

import { getActiveSession } from '../recording-context.js';
import { originalDateNow as _originalDateNow, originalMathRandom as _originalMathRandom } from '../internal-clock.js';

let installed = false;

// Re-entrancy guard: prevents infinite recursion when session.record()
// internally calls Date.now() or Math.random() (e.g., via ulid() or HLC).
let _recording = false;

/**
 * Install global interceptors for non-determinism sources.
 * Safe to call multiple times — only installs once.
 */
export function installGlobalInterceptors(): void {
  if (installed) return;
  installed = true;

  // ── Date.now() ──────────────────────────────────────────────────

  Date.now = function paradoxDateNow(): number {
    const value = _originalDateNow();
    if (_recording) return value; // Re-entrancy: don't record our own internal calls
    const session = getActiveSession();
    if (session) {
      _recording = true;
      try {
        session.record('timestamp', 'Date.now()', { value });
      } finally {
        _recording = false;
      }
    }
    return value;
  };

  // ── Math.random() ──────────────────────────────────────────────

  Math.random = function paradoxMathRandom(): number {
    const value = _originalMathRandom();
    if (_recording) return value; // Re-entrancy: don't record our own internal calls
    const session = getActiveSession();
    if (session) {
      _recording = true;
      try {
        session.record('random', 'Math.random()', { value });
      } finally {
        _recording = false;
      }
    }
    return value;
  };
}

/**
 * Uninstall global interceptors. Restores original functions.
 * Important for clean testing and graceful shutdown.
 */
export function uninstallGlobalInterceptors(): void {
  if (!installed) return;
  installed = false;

  Date.now = _originalDateNow;
  Math.random = _originalMathRandom;
}

// Re-export from internal-clock for backward compat
export { originalDateNow, originalMathRandom } from '../internal-clock.js';
