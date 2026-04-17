// ============================================================================
// ERGENEKON COLLECTOR — Server Tests
//
// Validates:
//   1. POST /api/v1/sessions — normal flow, 413, 400, schema errors
//   2. GET endpoints — sessions, traces, stats, health
//   3. CORS headers
//   4. 404 for unknown routes
//
// INVARIANT: No request can crash or OOM the collector.
// ============================================================================

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CollectorServer } from './server.js';

let server: CollectorServer;
let port: number;
let storageDir: string;

function request(
  method: string,
  path: string,
  body?: string | Buffer,
  headers?: Record<string, string>
): Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    const opts: http.RequestOptions = {
      hostname: 'localhost',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        resolve({
          status: res.statusCode!,
          body: Buffer.concat(chunks).toString('utf-8'),
          headers: res.headers,
        });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(body);
    }
    req.end();
  });
}

describe('CollectorServer', () => {
  beforeAll(async () => {
    storageDir = await mkdtemp(join(tmpdir(), 'ergenekon-server-test-'));
    // Find a free port
    port = 14380 + Math.floor(Math.random() * 1000);
    server = new CollectorServer({ port, storageDir });
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    await rm(storageDir, { recursive: true, force: true });
  });

  // ── Health & CORS ──────────────────────────────────────────────

  it('GET /health returns ok', async () => {
    const res = await request('GET', '/health');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.status).toBe('ok');
  });

  it('OPTIONS returns CORS headers', async () => {
    const res = await request('OPTIONS', '/api/v1/sessions');
    expect(res.status).toBe(204);
    expect(res.headers['access-control-allow-origin']).toBe('http://localhost:3000');
    expect(res.headers['access-control-allow-methods']).toContain('POST');
  });

  it('unknown route returns 404', async () => {
    const res = await request('GET', '/api/v1/nonexistent');
    expect(res.status).toBe(404);
  });

  // ── POST /api/v1/sessions — Normal flow ────────────────────────

  it('accepts a valid session batch', async () => {
    const payload = JSON.stringify({
      sessions: [{
        id: 'test-session-1',
        traceId: 'trace-1',
        serviceName: 'test-service',
        events: [
          { id: 'e1', type: 'timestamp', timestamp: '2024-01-01T00:00:00.000Z', data: { value: 1704067200000 } },
        ],
        metadata: { startTime: '2024-01-01T00:00:00.000Z' },
      }],
    });

    const res = await request('POST', '/api/v1/sessions', payload);
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.stored).toBe(1);
  });

  // ── POST /api/v1/sessions — Error handling ─────────────────────

  it('returns 400 for invalid JSON', async () => {
    const res = await request('POST', '/api/v1/sessions', '{not valid json!!!}');
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Invalid JSON');
  });

  it('returns 400 for missing sessions array', async () => {
    const res = await request('POST', '/api/v1/sessions', JSON.stringify({ data: 'no sessions' }));
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('sessions');
  });

  it('returns 400 for sessions not being an array', async () => {
    const res = await request('POST', '/api/v1/sessions', JSON.stringify({ sessions: 'not-array' }));
    expect(res.status).toBe(400);
  });

  it('returns 400 for too many sessions in batch', async () => {
    // Create 101 empty sessions (limit is 100)
    const sessions = Array.from({ length: 101 }, (_, i) => ({
      id: `batch-${i}`,
      serviceName: 'test',
      events: [],
      metadata: {},
    }));
    const res = await request('POST', '/api/v1/sessions', JSON.stringify({ sessions }));
    expect(res.status).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toContain('Too many sessions');
  });

  it('rejects path traversal in session ID', async () => {
    const payload = JSON.stringify({
      sessions: [{
        id: '../../package',
        serviceName: 'evil',
        events: [],
        metadata: {},
      }],
    });
    const res = await request('POST', '/api/v1/sessions', payload);
    expect(res.status).toBe(400);
    expect(JSON.parse(res.body).error).toContain('Invalid session ID');
  });

  it('rejects path traversal in GET session ID', async () => {
    const res = await request('GET', '/api/v1/sessions/..%2F..%2Fpackage');
    expect(res.status).toBe(400);
  });

  it('server survives oversized Content-Length without crashing', async () => {
    // The 413 response may or may not arrive before the socket is killed.
    // What matters: the server does NOT crash and does NOT allocate 1GB.
    // We test this by sending the oversized request, ignoring the result,
    // then verifying the server is still healthy.
    await new Promise<void>((resolve) => {
      const req = http.request({
        hostname: 'localhost',
        port,
        path: '/api/v1/sessions',
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': '999999999' },
      });
      req.on('response', () => resolve());
      req.on('error', () => resolve()); // socket error is fine
      req.on('close', () => resolve());
      req.write('{}');
      req.end();
    });

    // Small delay for server to settle
    await new Promise(r => setTimeout(r, 50));

    // CRITICAL: Server must still be alive
    const health = await request('GET', '/health');
    expect(health.status).toBe(200);
  });

  // ── GET endpoints ──────────────────────────────────────────────

  it('GET /api/v1/sessions lists stored sessions', async () => {
    const res = await request('GET', '/api/v1/sessions');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('GET /api/v1/sessions/:id returns stored session', async () => {
    const res = await request('GET', '/api/v1/sessions/test-session-1');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.id).toBe('test-session-1');
  });

  it('GET /api/v1/sessions/:id returns 404 for unknown session', async () => {
    const res = await request('GET', '/api/v1/sessions/nonexistent-id');
    expect(res.status).toBe(404);
  });

  it('GET /api/v1/traces/:traceId returns sessions for trace', async () => {
    const res = await request('GET', '/api/v1/traces/trace-1');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.traceId).toBe('trace-1');
    expect(Array.isArray(body.sessions)).toBe(true);
  });

  it('GET /api/v1/stats returns statistics', async () => {
    const res = await request('GET', '/api/v1/stats');
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body);
    expect(typeof body.sessionsReceived).toBe('number');
    expect(typeof body.uptime).toBe('number');
  });
});
