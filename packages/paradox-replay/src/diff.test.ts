// ============================================================================
// ERGENEKON REPLAY — Diff Tests
//
// Validates Issue 6 fix:
//   1. Key order is irrelevant (the whole point)
//   2. Typed diff output with paths
//   3. Handles edge cases (null, undefined, NaN, arrays, nested)
//   4. Ignore paths work
// ============================================================================

import { describe, it, expect } from 'vitest';
import { deepEqual, deepDiff } from './diff.js';

describe('deepEqual', () => {
  it('treats key order as irrelevant', () => {
    expect(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 })).toBe(true);
  });

  it('deep nested key order is irrelevant', () => {
    const a = { user: { name: 'Ali', age: 30 }, meta: { ts: 123 } };
    const b = { meta: { ts: 123 }, user: { age: 30, name: 'Ali' } };
    expect(deepEqual(a, b)).toBe(true);
  });

  it('detects value differences', () => {
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
  });

  it('detects missing keys', () => {
    expect(deepEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
  });

  it('detects extra keys', () => {
    expect(deepEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
  });

  it('handles null vs undefined', () => {
    expect(deepEqual(null, undefined)).toBe(false);
    expect(deepEqual(null, null)).toBe(true);
    expect(deepEqual(undefined, undefined)).toBe(true);
  });

  it('handles NaN', () => {
    expect(deepEqual(NaN, NaN)).toBe(true);
    expect(deepEqual(NaN, 0)).toBe(false);
  });

  it('handles arrays', () => {
    expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(deepEqual([1, 2], [1, 2, 3])).toBe(false);
  });

  it('handles nested arrays with objects', () => {
    expect(deepEqual(
      [{ b: 2, a: 1 }],
      [{ a: 1, b: 2 }]
    )).toBe(true);
  });

  it('handles primitives', () => {
    expect(deepEqual('hello', 'hello')).toBe(true);
    expect(deepEqual(42, 42)).toBe(true);
    expect(deepEqual(true, true)).toBe(true);
    expect(deepEqual('a', 'b')).toBe(false);
  });

  it('handles type mismatches', () => {
    expect(deepEqual(1, '1')).toBe(false);
    expect(deepEqual([], {})).toBe(false);
  });
});

describe('deepDiff', () => {
  it('returns empty array for identical values', () => {
    expect(deepDiff({ a: 1 }, { a: 1 })).toEqual([]);
  });

  it('returns typed diffs with paths', () => {
    const diffs = deepDiff(
      { user: { name: 'Ali', age: 30 } },
      { user: { name: 'Veli', age: 30 } }
    );
    expect(diffs).toHaveLength(1);
    expect(diffs[0]!.path).toBe('user.name');
    expect(diffs[0]!.kind).toBe('value');
    expect(diffs[0]!.expected).toBe('Ali');
    expect(diffs[0]!.actual).toBe('Veli');
  });

  it('reports missing keys on both sides', () => {
    const diffs = deepDiff({ a: 1 }, { b: 2 });
    expect(diffs).toHaveLength(2);
    const missing_right = diffs.find(d => d.kind === 'missing_right');
    const missing_left = diffs.find(d => d.kind === 'missing_left');
    expect(missing_right!.path).toBe('a');
    expect(missing_left!.path).toBe('b');
  });

  it('reports array length mismatches', () => {
    const diffs = deepDiff([1, 2], [1, 2, 3]);
    const lenDiff = diffs.find(d => d.kind === 'array_length');
    expect(lenDiff).toBeDefined();
    expect(lenDiff!.expected).toBe(2);
    expect(lenDiff!.actual).toBe(3);
  });

  it('respects ignorePaths', () => {
    const diffs = deepDiff(
      { id: 'req-1', data: 'same' },
      { id: 'req-2', data: 'same' },
      { ignorePaths: ['id'] }
    );
    expect(diffs).toEqual([]);
  });

  it('respects wildcard ignorePaths (**.field)', () => {
    const diffs = deepDiff(
      { a: { requestId: '1' }, b: { requestId: '2' } },
      { a: { requestId: '3' }, b: { requestId: '4' } },
      { ignorePaths: ['**.requestId'] }
    );
    expect(diffs).toEqual([]);
  });

  it('handles deeply nested structures', () => {
    const a = { l1: { l2: { l3: { l4: { l5: 'deep' } } } } };
    const b = { l1: { l2: { l3: { l4: { l5: 'deep' } } } } };
    expect(deepDiff(a, b)).toEqual([]);
  });
});
