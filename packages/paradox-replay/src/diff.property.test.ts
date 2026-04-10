// ============================================================================
// PARADOX REPLAY — Diff Property Tests (fast-check)
//
// Property: For ANY JSON tree, key permutation produces zero diffs.
// This is the mathematical invariant that Issue 6 fix enforces.
// ============================================================================

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { deepEqual, deepDiff } from './diff.js';

/** Recursively permute all object keys in a JSON tree */
function permuteKeys(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(permuteKeys);

  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);

  // Fisher-Yates shuffle
  for (let i = keys.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [keys[i], keys[j]] = [keys[j]!, keys[i]!];
  }

  const result: Record<string, unknown> = {};
  for (const key of keys) {
    result[key] = permuteKeys(obj[key]);
  }
  return result;
}

// JSON-safe arbitrary (no undefined, no NaN, no Infinity)
const jsonArb = fc.json().map(s => JSON.parse(s));

describe('deepDiff — Property Tests', () => {
  it('PROPERTY: diff(a, permuteKeys(a)) === [] for any JSON tree', () => {
    fc.assert(
      fc.property(jsonArb, (value) => {
        const permuted = permuteKeys(value);
        const diffs = deepDiff(value, permuted);
        expect(diffs).toEqual([]);
      }),
      { numRuns: 500 }
    );
  });

  it('PROPERTY: deepEqual is reflexive — deepEqual(a, a) for any JSON', () => {
    fc.assert(
      fc.property(jsonArb, (value) => {
        expect(deepEqual(value, value)).toBe(true);
      }),
      { numRuns: 500 }
    );
  });

  it('PROPERTY: deepEqual is symmetric — deepEqual(a, b) === deepEqual(b, a)', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (a, b) => {
        expect(deepEqual(a, b)).toBe(deepEqual(b, a));
      }),
      { numRuns: 500 }
    );
  });

  it('PROPERTY: diff count is symmetric', () => {
    fc.assert(
      fc.property(jsonArb, jsonArb, (a, b) => {
        // Both directions should report the same number of diffs
        // (paths/directions may differ, but count should match)
        const ab = deepDiff(a, b);
        const ba = deepDiff(b, a);
        expect(ab.length).toBe(ba.length);
      }),
      { numRuns: 200 }
    );
  });
});
