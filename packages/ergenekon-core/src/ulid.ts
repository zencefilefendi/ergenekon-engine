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

let lastTime = -1;
let lastRandom: Uint8Array = new Uint8Array(10); // 80 bits = 10 bytes

function encodeRandomMonotonic(time: number, outStrLength: number): string {
  // SECURITY (HIGH-26): Use crypto.randomBytes instead of Math.random
  const bytes = new Uint8Array(10);
  
  if (time === lastTime) {
    // Increment the last random value by 1 to ensure monotonicity
    let carry = 1;
    for (let i = 9; i >= 0; i--) {
      const sum = lastRandom[i]! + carry;
      bytes[i] = sum & 0xFF;
      carry = sum >> 8;
    }
  } else {
    bytes.set(randomBytes(10));
  }
  
  lastTime = time;
  lastRandom.set(bytes);
  
  // Convert 80 bits (10 bytes) to 16 Base32 characters
  // 10 bytes = 80 bits. 80 / 5 = 16 characters.
  let str = '';
  // We can just treat bytes as a stream of random values
  for (let i = 0; i < outStrLength; i++) {
    // A simple mapping from our monotonic bytes to base32 chars.
    // For proper ULID, we should read 5 bits at a time.
    // To keep it simple but monotonic, we can just hash it or read 5 bits.
    // Actually, just mapping byte % 32 loses monotonicity.
    // Let's do a proper 5-bit read.
    const bitIndex = i * 5;
    const byteIndex = Math.floor(bitIndex / 8);
    const bitOffset = bitIndex % 8;
    
    let val = 0;
    if (bitOffset <= 3) {
      // All 5 bits are in this byte
      val = (bytes[byteIndex]! >> (3 - bitOffset)) & 0x1F;
    } else {
      // Crosses byte boundary
      const part1 = (bytes[byteIndex]! & ((1 << (8 - bitOffset)) - 1)) << (bitOffset - 3);
      const part2 = bytes[byteIndex + 1]! >> (11 - bitOffset);
      val = (part1 | part2) & 0x1F;
    }
    str += ENCODING[val];
  }
  return str;
}

/**
 * Generate a ULID.
 * Format: 10 chars time (48-bit ms) + 16 chars random (80-bit)
 * Total: 26 chars, lexicographically sortable by creation time.
 */
export function ulid(time: number = Date.now()): string {
  return encodeTime(time, 10) + encodeRandomMonotonic(time, 16);
}
