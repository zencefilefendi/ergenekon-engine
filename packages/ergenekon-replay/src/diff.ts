// ============================================================================
// ERGENEKON REPLAY — Canonical Deep Diff
//
// Structural deep equality that ignores JSON key ordering.
// Replaces the broken JSON.stringify comparison (Issue 6).
//
// Features:
//   - Key-order independent (the whole point)
//   - Typed diff output: { path, kind, expected, actual }
//   - Pluggable ignore list (fintech may ignore requestId, timestamps)
//   - Handles null, undefined, NaN, Infinity correctly
//   - Recursive with cycle detection
//
// INVARIANT: deepEqual(a, permuteKeys(a)) === true for any JSON tree
// ============================================================================

export interface DiffEntry {
  path: string;
  kind: 'value' | 'type' | 'missing_left' | 'missing_right' | 'array_length';
  expected: unknown;
  actual: unknown;
}

export interface DiffOptions {
  /** Field paths to ignore (glob-like: 'body.requestId', '**.timestamp') */
  ignorePaths?: string[];
  /** Maximum depth to prevent infinite recursion (default: 50) */
  maxDepth?: number;
}

/**
 * Deep structural equality check, key-order independent.
 * Returns true if a and b are structurally identical.
 */
export function deepEqual(a: unknown, b: unknown, options?: DiffOptions): boolean {
  return deepDiff(a, b, options).length === 0;
}

/**
 * Compute structural differences between two values.
 * Returns an empty array if the values are structurally identical.
 * Key ordering is irrelevant — {a:1, b:2} equals {b:2, a:1}.
 */
export function deepDiff(
  expected: unknown,
  actual: unknown,
  options?: DiffOptions
): DiffEntry[] {
  const diffs: DiffEntry[] = [];
  const ignoreSet = new Set(options?.ignorePaths ?? []);
  const maxDepth = options?.maxDepth ?? 50;
  const seen = new WeakSet();

  function shouldIgnore(path: string): boolean {
    if (ignoreSet.has(path)) return true;
    // Check wildcard patterns: '**.fieldName' matches any depth
    const field = path.split('.').pop() ?? '';
    return ignoreSet.has(`**.${field}`);
  }

  function walk(a: unknown, b: unknown, path: string, depth: number): void {
    if (depth > maxDepth) return;
    if (shouldIgnore(path)) return;

    // Identical references or primitives
    if (a === b) return;

    // Handle null/undefined
    if (a === null || a === undefined || b === null || b === undefined) {
      if (a !== b) {
        diffs.push({ path, kind: 'type', expected: a, actual: b });
      }
      return;
    }

    // Handle NaN
    if (typeof a === 'number' && typeof b === 'number') {
      if (Number.isNaN(a) && Number.isNaN(b)) return;
      if (a !== b) {
        diffs.push({ path, kind: 'value', expected: a, actual: b });
      }
      return;
    }

    // Different types
    if (typeof a !== typeof b) {
      diffs.push({ path, kind: 'type', expected: a, actual: b });
      return;
    }

    // Primitives (string, number, boolean)
    if (typeof a !== 'object') {
      if (a !== b) {
        diffs.push({ path, kind: 'value', expected: a, actual: b });
      }
      return;
    }

    // Arrays
    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) {
        diffs.push({
          path,
          kind: 'array_length',
          expected: a.length,
          actual: b.length,
        });
      }
      const len = Math.max(a.length, b.length);
      for (let i = 0; i < len; i++) {
        walk(a[i], b[i], `${path}[${i}]`, depth + 1);
      }
      return;
    }

    // One is array, other is not
    if (Array.isArray(a) !== Array.isArray(b)) {
      diffs.push({ path, kind: 'type', expected: a, actual: b });
      return;
    }

    // Objects — cycle detection
    const objA = a as Record<string, unknown>;
    const objB = b as Record<string, unknown>;

    if (seen.has(objA) || seen.has(objB)) return;
    seen.add(objA);
    seen.add(objB);

    // Key-order independent: union of all enumerable own keys.
    // We use Object.keys() rather than getOwnPropertyNames() because:
    //   1. JSON.parse output only has enumerable properties
    //   2. __proto__ as a getOwnPropertyNames result is a JS engine quirk
    //      that creates false diffs on structurally identical JSON
    const allKeys = new Set([
      ...Object.keys(objA),
      ...Object.keys(objB),
    ]);
    for (const key of allKeys) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue;
      const childPath = path ? `${path}.${key}` : key;
      if (!(key in objA)) {
        if (!shouldIgnore(childPath)) {
          diffs.push({ path: childPath, kind: 'missing_left', expected: undefined, actual: objB[key] });
        }
      } else if (!(key in objB)) {
        if (!shouldIgnore(childPath)) {
          diffs.push({ path: childPath, kind: 'missing_right', expected: objA[key], actual: undefined });
        }
      } else {
        walk(objA[key], objB[key], childPath, depth + 1);
      }
    }
  }

  walk(expected, actual, '', 0);
  return diffs;
}
