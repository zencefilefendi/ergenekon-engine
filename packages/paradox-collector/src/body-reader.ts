// ============================================================================
// PARADOX COLLECTOR — Safe Body Reader
//
// Replaces the unbounded readBody() that was vulnerable to OOM DoS.
//
// Defense layers:
//   1. Content-Length pre-check (reject before reading a byte)
//   2. Hard byte limit during streaming (abort mid-stream)
//   3. Returns 413 Payload Too Large on violation
//
// INVARIANT: Never allocates more than maxBytes of memory for a single request.
// ============================================================================

import type { IncomingMessage } from 'node:http';

/** Default max body size: 16 MB (one large session) */
export const DEFAULT_MAX_BODY_BYTES = 16 * 1024 * 1024;

export class PayloadTooLargeError extends Error {
  public readonly statusCode = 413;
  constructor(maxBytes: number, actual?: number) {
    super(
      actual
        ? `Payload too large: ${actual} bytes exceeds limit of ${maxBytes} bytes`
        : `Payload too large: exceeds limit of ${maxBytes} bytes`
    );
    this.name = 'PayloadTooLargeError';
  }
}

/**
 * Read request body with a hard byte limit.
 * Throws PayloadTooLargeError if the limit is exceeded.
 */
export function readBody(
  req: IncomingMessage,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES
): Promise<string> {
  return new Promise((resolve, reject) => {
    // Layer 1: Content-Length pre-check (reject before reading a byte)
    // NOTE: We do NOT destroy the request here — the caller (server) needs
    // the socket alive to send a 413 response. The caller destroys after responding.
    const declaredLength = req.headers['content-length'];
    if (declaredLength) {
      const len = parseInt(declaredLength, 10);
      if (!Number.isNaN(len) && len > maxBytes) {
        return reject(new PayloadTooLargeError(maxBytes, len));
      }
    }

    // Layer 2: Streaming byte count
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    req.on('data', (chunk: Buffer) => {
      totalBytes += chunk.length;
      if (totalBytes > maxBytes) {
        req.destroy();
        return reject(new PayloadTooLargeError(maxBytes, totalBytes));
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf-8'));
    });

    req.on('error', reject);
  });
}
