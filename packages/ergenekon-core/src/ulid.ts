// ============================================================================
// ERGENEKON ENGINE — Minimal ULID Generator
//
// Universally Unique Lexicographically Sortable Identifier
// Time-sortable, 128-bit, Crockford Base32 encoded
// No external dependencies.
// ============================================================================

import { randomBytes } from 'node:crypto';

const ENCODING = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford Base32

function encodeTime(time: number, length: number): string {
  let str = '';
  for (let i = length - 1; i >= 0; i--) {
    const mod = time % 32;
    str = ENCODING[mod] + str;
    time = (time - mod) / 32;
  }
  return str;
}

function encodeRandom(length: number): string {
  // SECURITY (HIGH-26): Use crypto.randomBytes instead of Math.random
  const bytes = randomBytes(length);
  let str = '';
  for (let i = 0; i < length; i++) {
    str += ENCODING[bytes[i]! % 32];
  }
  return str;
}

/**
 * Generate a ULID.
 * Format: 10 chars time (48-bit ms) + 16 chars random (80-bit)
 * Total: 26 chars, lexicographically sortable by creation time.
 */
export function ulid(time: number = Date.now()): string {
  return encodeTime(time, 10) + encodeRandom(16);
}
