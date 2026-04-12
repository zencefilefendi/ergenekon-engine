// ============================================================================
// PARADOX COLLECTOR — Body Reader Tests
//
// Validates Issue 3 fix (JSON parse DoS):
//   1. Content-Length pre-check rejects before reading a byte
//   2. Streaming byte limit aborts mid-stream
//   3. Normal payloads pass through
//   4. Empty bodies work
// ============================================================================

import { describe, it, expect } from 'vitest';
import { Readable, PassThrough } from 'node:stream';
import type { IncomingMessage } from 'node:http';
import { readBody, PayloadTooLargeError, DEFAULT_MAX_BODY_BYTES } from './body-reader.js';

/** Create a fake IncomingMessage from a string or buffer */
function fakeRequest(
  body: string | Buffer,
  headers: Record<string, string> = {}
): IncomingMessage {
  const stream = new PassThrough();
  // Attach headers like IncomingMessage
  (stream as any).headers = {
    'content-length': Buffer.byteLength(
      typeof body === 'string' ? body : body
    ).toString(),
    ...headers,
  };
  // Push data in chunks to simulate streaming
  const buf = typeof body === 'string' ? Buffer.from(body) : body;
  // Push in 1KB chunks
  const chunkSize = 1024;
  for (let i = 0; i < buf.length; i += chunkSize) {
    stream.push(buf.subarray(i, i + chunkSize));
  }
  stream.push(null); // EOF
  return stream as unknown as IncomingMessage;
}

/** Create a fake request with no content-length header */
function fakeRequestNoContentLength(body: string): IncomingMessage {
  const stream = new PassThrough();
  (stream as any).headers = {};
  const buf = Buffer.from(body);
  stream.push(buf);
  stream.push(null);
  return stream as unknown as IncomingMessage;
}

/** Create a streaming request that sends data in timed chunks */
function fakeStreamingRequest(
  chunks: Buffer[],
  headers: Record<string, string> = {}
): IncomingMessage {
  const stream = new PassThrough();
  (stream as any).headers = headers;
  // Push chunks async
  let i = 0;
  const pushNext = () => {
    if (i < chunks.length) {
      stream.push(chunks[i]);
      i++;
      setImmediate(pushNext);
    } else {
      stream.push(null);
    }
  };
  setImmediate(pushNext);
  return stream as unknown as IncomingMessage;
}

describe('readBody', () => {
  it('reads a normal small body', async () => {
    const payload = JSON.stringify({ sessions: [{ id: 'test-1', events: [] }] });
    const req = fakeRequest(payload);
    const result = await readBody(req);
    expect(result).toBe(payload);
  });

  it('reads empty body', async () => {
    const req = fakeRequest('');
    const result = await readBody(req);
    expect(result).toBe('');
  });

  it('Layer 1: rejects via Content-Length pre-check before reading', async () => {
    const stream = new PassThrough();
    (stream as any).headers = { 'content-length': '999999999' };

    const req = stream as unknown as IncomingMessage;
    await expect(readBody(req, 1024)).rejects.toThrow(PayloadTooLargeError);
    // Stream is NOT destroyed — caller (server) handles cleanup after responding
    stream.destroy();
  });

  it('Layer 1: does not reject if Content-Length is within limit', async () => {
    const payload = 'x'.repeat(100);
    const req = fakeRequest(payload);
    const result = await readBody(req, 1024);
    expect(result).toBe(payload);
  });

  it('Layer 2: aborts mid-stream when no Content-Length but payload too large', async () => {
    // 10KB of data, 1KB limit, no Content-Length header
    const bigBody = 'x'.repeat(10 * 1024);
    const req = fakeRequestNoContentLength(bigBody);
    await expect(readBody(req, 1024)).rejects.toThrow(PayloadTooLargeError);
  });

  it('Layer 2: aborts mid-stream with chunked delivery', async () => {
    const chunks = [
      Buffer.alloc(512, 'a'),
      Buffer.alloc(512, 'b'),
      Buffer.alloc(512, 'c'), // This pushes past 1KB limit
    ];
    const req = fakeStreamingRequest(chunks);
    await expect(readBody(req, 1024)).rejects.toThrow(PayloadTooLargeError);
  });

  it('PayloadTooLargeError has correct statusCode', () => {
    const err = new PayloadTooLargeError(1024, 2048);
    expect(err.statusCode).toBe(413);
    expect(err.name).toBe('PayloadTooLargeError');
    expect(err.message).toContain('2048');
    expect(err.message).toContain('1024');
  });

  it('PayloadTooLargeError without actual size', () => {
    const err = new PayloadTooLargeError(1024);
    expect(err.statusCode).toBe(413);
    expect(err.message).toContain('1024');
    expect(err.message).not.toContain('undefined');
  });

  it('DEFAULT_MAX_BODY_BYTES is 16MB', () => {
    expect(DEFAULT_MAX_BODY_BYTES).toBe(16 * 1024 * 1024);
  });

  it('handles stream error', async () => {
    const stream = new PassThrough();
    (stream as any).headers = {};
    const req = stream as unknown as IncomingMessage;

    const promise = readBody(req, 1024);
    stream.destroy(new Error('connection reset'));

    await expect(promise).rejects.toThrow('connection reset');
  });
});
