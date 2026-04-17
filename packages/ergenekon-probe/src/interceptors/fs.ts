// ============================================================================
// ERGENEKON PROBE — File System Interceptor
//
// Captures fs.promises and key fs callback operations for deterministic replay.
// Fintech services read certs, configs, and key material from the filesystem —
// these reads must be deterministic during replay.
//
// Intercepted operations:
//   - fs.promises.readFile
//   - fs.promises.writeFile
//   - fs.promises.access
//   - fs.promises.stat
//   - fs.promises.readdir
//
// Design:
//   - Patches fs.promises (not the ESM namespace directly) to avoid
//     "Cannot redefine property" errors with ESM module namespaces
//   - Preserves original function references for clean uninstall
//   - Zero overhead when not recording (fast path)
//   - Records both successful results and errors
//
// INVARIANT: installFsInterceptor/uninstallFsInterceptor are symmetric.
// ============================================================================

import fs from 'node:fs';
import { getActiveSession } from '../recording-context.js';
import { originalDateNow } from '../internal-clock.js';

let installed = false;

// Original function references
const originals: Record<string, Function> = {};
let origReadFileSync: typeof fs.readFileSync | null = null;
let origReadFileCb: typeof fs.readFile | null = null;

const INTERCEPTED_METHODS = [
  'readFile',
  'writeFile',
  'access',
  'stat',
  'readdir',
] as const;

type InterceptedMethod = typeof INTERCEPTED_METHODS[number];

/**
 * Install the fs.promises interceptor.
 * Captures filesystem operations for recording sessions.
 *
 * NOTE: We patch fs.promises (via the `fs` default export) rather than
 * importing `node:fs/promises` as an ESM namespace — ESM namespace objects
 * are sealed/frozen and their properties cannot be reassigned.
 */
export function installFsInterceptor(): void {
  if (installed) return;
  installed = true;

  const fsp = fs.promises;
  for (const method of INTERCEPTED_METHODS) {
    originals[method] = (fsp as any)[method];
    (fsp as any)[method] = createWrapper(method, originals[method]!);
  }

  // Sync / Callback variants
  origReadFileSync = fs.readFileSync;
  (fs as any).readFileSync = createSyncWrapper('readFileSync', origReadFileSync!);

  origReadFileCb = fs.readFile;
  (fs as any).readFile = createCbWrapper('readFile', origReadFileCb!);
}

/**
 * Uninstall the fs.promises interceptor.
 * Restores original functions.
 */
export function uninstallFsInterceptor(): void {
  if (!installed) return;
  installed = false;

  const fsp = fs.promises;
  for (const method of INTERCEPTED_METHODS) {
    if (originals[method]) {
      (fsp as any)[method] = originals[method];
      delete originals[method];
    }
  }

  if (origReadFileSync) {
    (fs as any).readFileSync = origReadFileSync;
    origReadFileSync = null;
  }
  if (origReadFileCb) {
    (fs as any).readFile = origReadFileCb;
    origReadFileCb = null;
  }
}

function createWrapper(method: InterceptedMethod, original: Function): Function {
  return async function ergenekonFs(...args: unknown[]): Promise<unknown> {
    const session = getActiveSession();

    // No active recording — pass through with zero overhead
    if (!session) {
      return original.apply(fs.promises, args);
    }

    // Determine file path for the event description
    const filePath = typeof args[0] === 'string'
      ? args[0]
      : (args[0] instanceof URL ? args[0].pathname : String(args[0]));

    // Record the outgoing fs call
    session.record('fs_call', `fs.${method}(${filePath})`, {
      method,
      path: filePath,
      args: sanitizeArgs(args),
    });

    const start = originalDateNow();

    try {
      const result = await original.apply(fs.promises, args);
      const durationMs = originalDateNow() - start;

      // Record the result
      session.record('fs_result', `fs.${method} → ok (${durationMs}ms)`, {
        method,
        path: filePath,
        durationMs,
        result: serializeResult(method, result),
      });

      return result;
    } catch (err) {
      const durationMs = originalDateNow() - start;

      session.record('fs_error', `fs.${method} → error`, {
        method,
        path: filePath,
        durationMs,
        error: err instanceof Error ? { code: (err as any).code, message: err.message } : String(err),
      });

      throw err;
    }
  };
}

function createSyncWrapper(method: string, original: Function): Function {
  return function ergenekonFsSync(...args: unknown[]): unknown {
    const session = getActiveSession();
    if (!session) return original.apply(fs, args);

    const filePath = typeof args[0] === 'string' ? args[0] : (args[0] instanceof URL ? args[0].pathname : String(args[0]));
    session.record('fs_call', `fs.${method}(${filePath})`, { method, path: filePath, args: sanitizeArgs(args) });
    const start = originalDateNow();
    try {
      const result = original.apply(fs, args);
      const durationMs = originalDateNow() - start;
      session.record('fs_result', `fs.${method} → ok (${durationMs}ms)`, { method, path: filePath, durationMs, result: serializeResult('readFile', result) });
      return result;
    } catch (err) {
      session.record('fs_error', `fs.${method} → error`, { method, path: filePath, durationMs: originalDateNow() - start, error: err instanceof Error ? { code: (err as any).code, message: err.message } : String(err) });
      throw err;
    }
  };
}

function createCbWrapper(method: string, original: Function): Function {
  return function ergenekonFsCb(...args: unknown[]): void {
    const session = getActiveSession();
    if (!session) return original.apply(fs, args);

    const filePath = typeof args[0] === 'string' ? args[0] : (args[0] instanceof URL ? args[0].pathname : String(args[0]));
    session.record('fs_call', `fs.${method}(${filePath})`, { method, path: filePath, args: sanitizeArgs(args) });
    const start = originalDateNow();

    const lastArg = args[args.length - 1];
    if (typeof lastArg !== 'function') return original.apply(fs, args); // invalid signature

    args[args.length - 1] = function wrappedCallback(err: NodeJS.ErrnoException | null, result: unknown) {
      const durationMs = originalDateNow() - start;
      if (err) {
        session.record('fs_error', `fs.${method} → error`, { method, path: filePath, durationMs, error: { code: err.code, message: err.message } });
      } else {
        session.record('fs_result', `fs.${method} → ok (${durationMs}ms)`, { method, path: filePath, durationMs, result: serializeResult('readFile', result) });
      }
      return lastArg.apply(this, arguments);
    };

    return original.apply(fs, args);
  };
}

/** Sanitize arguments for recording (remove Buffer content, keep metadata) */
function sanitizeArgs(args: unknown[]): unknown[] {
  return args.map((arg, i) => {
    if (Buffer.isBuffer(arg)) return `<Buffer ${arg.length} bytes>`;
    if (typeof arg === 'object' && arg !== null && !(arg instanceof URL)) {
      // Options object — keep as-is but truncate large values
      return arg;
    }
    return arg;
  });
}

/** Serialize fs result for recording (truncate large content) */
function serializeResult(method: InterceptedMethod, result: unknown): unknown {
  if (method === 'readFile') {
    if (Buffer.isBuffer(result)) {
      const size = result.length;
      // Record size only to prevent leaking sensitive file contents (e.g. .env or keys)
      return { type: 'buffer', size };
    }
    if (typeof result === 'string') {
      return { type: 'string', size: result.length };
    }
  }
  if (method === 'stat') {
    const s = result as import('node:fs').Stats;
    return {
      size: s.size,
      isFile: s.isFile(),
      isDirectory: s.isDirectory(),
      mtimeMs: s.mtimeMs,
      mode: s.mode,
    };
  }
  if (method === 'readdir') {
    return result; // Array of strings or Dirents
  }
  if (method === 'writeFile' || method === 'access') {
    return undefined; // No meaningful return value
  }
  return result;
}
