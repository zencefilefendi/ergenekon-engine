// ============================================================================
// ERGENEKON COLLECTOR — Checksum Utilities
//
// SHA-256 checksums for session integrity verification.
// Every stored session file has a checksum header that is validated on load.
//
// INVARIANT: If checksum doesn't match, the file is corrupt.
//            Corrupt files are quarantined, never silently skipped.
// ============================================================================

import { createHash } from 'node:crypto';

export interface ChecksummedFile {
  _cksum: string;     // "sha256:<hex>"
  _v: number;         // format version (currently 1)
  data: unknown;      // the actual session data
}

/** Compute SHA-256 hex digest of JSON-stringified data */
export function computeChecksum(data: unknown): string {
  const hash = createHash('sha256')
    .update(JSON.stringify(data))
    .digest('hex');
  return `sha256:${hash}`;
}

/** Wrap data with a checksum header for durable storage */
export function wrapWithChecksum(data: unknown): string {
  const checksum = computeChecksum(data);
  const wrapped: ChecksummedFile = {
    _cksum: checksum,
    _v: 1,
    data,
  };
  return JSON.stringify(wrapped, null, 2);
}

/**
 * Verify and unwrap a checksummed file.
 * Returns the data if valid, throws if corrupt.
 */
export function verifyAndUnwrap<T>(content: string): T {
  let parsed: unknown;
  try {
    // SECURITY: Prototype pollution guard — disk files could be crafted
    parsed = JSON.parse(content, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
      return value;
    });
  } catch {
    throw new ChecksumError('Failed to parse JSON');
  }

  // SECURITY (CRIT-10): Legacy files without checksum are NOT silently returned.
  // We log a warning and mark as unverified. Previously this was a silent bypass.
  if (parsed && typeof parsed === 'object' && !('_cksum' in parsed)) {
    if (process.env['ALLOW_LEGACY_SESSIONS'] === 'true') {
      console.warn('[SECURITY] Loading legacy file without checksum — integrity NOT verified. Run migration to add checksums.');
      return parsed as T;
    } else {
      throw new ChecksumError('Missing checksum. File is untrusted (ALLOW_LEGACY_SESSIONS=false).');
    }
  }

  const wrapped = parsed as ChecksummedFile;
  if (!wrapped._cksum || !wrapped.data) {
    throw new ChecksumError('Missing checksum or data fields');
  }

  const expected = computeChecksum(wrapped.data);
  if (wrapped._cksum !== expected) {
    throw new ChecksumError(
      `Checksum mismatch: expected ${expected}, got ${wrapped._cksum}. File is corrupt.`
    );
  }

  return wrapped.data as T;
}

export class ChecksumError extends Error {
  constructor(message: string) {
    super(`[ERGENEKON] Checksum verification failed: ${message}`);
    this.name = 'ChecksumError';
  }
}
