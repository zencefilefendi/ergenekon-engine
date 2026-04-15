// ============================================================================
// ERGENEKON ENGINE — ULID Tests
//
// Validates:
//   1. Correct length and character set (Crockford Base32)
//   2. Lexicographic time ordering
//   3. Uniqueness under high generation rate
// ============================================================================

import { describe, it, expect } from 'vitest';
import { ulid } from './ulid.js';

const CROCKFORD_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/;

describe('ulid()', () => {
  it('returns a 26-character Crockford Base32 string', () => {
    for (let i = 0; i < 100; i++) {
      const id = ulid();
      expect(id).toHaveLength(26);
      expect(id).toMatch(CROCKFORD_RE);
    }
  });

  it('uses the first 10 chars to encode time deterministically', () => {
    const t = 1_700_000_000_000;
    const a = ulid(t).slice(0, 10);
    const b = ulid(t).slice(0, 10);
    expect(a).toBe(b);
  });

  it('is lexicographically sortable by time', () => {
    const ids = [
      ulid(1_000_000_000_000),
      ulid(1_500_000_000_000),
      ulid(2_000_000_000_000),
      ulid(2_500_000_000_000),
    ];
    const sorted = [...ids].sort();
    expect(sorted).toEqual(ids);
  });

  it('generates unique IDs within the same millisecond', () => {
    const t = Date.now();
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = ulid(t);
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it('produces distinct IDs with no time argument (natural clock)', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1_000; i++) ids.add(ulid());
    expect(ids.size).toBe(1_000);
  });

  it('rejects characters not in Crockford alphabet (I, L, O, U excluded)', () => {
    const forbidden = /[ILOU]/;
    for (let i = 0; i < 1_000; i++) {
      const id = ulid();
      expect(id).not.toMatch(forbidden);
    }
  });
});
