// ============================================================================
// ERGENEKON COLLECTOR — HTTP Server
//
// Receives recording sessions from probes and stores them.
// Provides a REST API for querying and retrieving recordings.
//
// Defense layers:
//   1. readBody() — hard 16MB byte limit, streaming abort → 413
//   2. JSON parse error → 400 Bad Request (not 500)
//   3. Schema validation — events array + length cap + required fields
//   4. Session ID validation — strict regex, path traversal prevention
//   5. Rate limiting — token bucket per IP
//   6. CORS + security headers
//
// SECURITY NOTES:
//   - TLS: The collector runs on localhost by default. For production
//     deployment over a network, ALWAYS run behind a TLS-terminating
//     reverse proxy (nginx, Caddy, cloud LB). Never expose the raw
//     HTTP collector to the public internet.
//   - Replay safety: The replay engine does NOT execute code from
//     recordings. It only substitutes I/O return values. The user's
//     own app code runs — never attacker-supplied code.
//
// INVARIANT: No request can OOM or crash the collector.
// ============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { RecordingSession, LicenseValidation } from '@ergenekon/core';
import { FileStorage, SessionIdError } from './storage.js';
import { readBody, PayloadTooLargeError, DEFAULT_MAX_BODY_BYTES } from './body-reader.js';
import { loadLicense, getTierDisplay } from '@ergenekon/core';
import { RateLimiter } from './rate-limiter.js';

/** Maximum number of events per session batch (prevents index explosion) */
const MAX_EVENTS_PER_SESSION = 1_000_000;
/** Maximum number of sessions per batch POST */
const MAX_SESSIONS_PER_BATCH = 100;

export interface CollectorServerConfig {
  port: number;
  storageDir: string;
}

export class CollectorServer {
  private readonly config: CollectorServerConfig;
  private readonly storage: FileStorage;
  private server: ReturnType<typeof createServer> | null = null;
  private readonly license: LicenseValidation;

  // Stats
  private sessionsReceived = 0;
  private eventsReceived = 0;
  private readonly rateLimiter: RateLimiter;

  constructor(config: CollectorServerConfig) {
    if (process.env['NODE_ENV'] === 'production' && !process.env['ERGENEKON_COLLECTOR_TOKEN']) {
      console.error('[SECURITY FATAL] ERGENEKON_COLLECTOR_TOKEN is required in production.');
      process.exit(1);
    }
    
    this.config = config;
    this.storage = new FileStorage(config.storageDir);
    this.license = loadLicense();
    this.rateLimiter = new RateLimiter({ maxTokens: 100, refillRate: 100 / 60 });
  }

  async start(): Promise<void> {
    await this.storage.init();

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        console.error('[ERGENEKON COLLECTOR] Unhandled error:', err);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      });
    });

    // SECURITY: Timeouts to prevent slow-loris and connection exhaustion attacks
    this.server.requestTimeout = 30_000;    // 30s max for full request
    this.server.headersTimeout = 10_000;    // 10s max for headers
    this.server.keepAliveTimeout = 5_000;   // 5s keep-alive
    this.server.maxRequestsPerSocket = 100; // Limit pipelining abuse

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, () => {
        const tierDisplay = getTierDisplay(this.license.tier);
        console.log(
          `[ERGENEKON COLLECTOR] Listening on port ${this.config.port}\n` +
          `[ERGENEKON COLLECTOR] Storage: ${this.config.storageDir}\n` +
          `[ERGENEKON COLLECTOR] License: ${tierDisplay}` +
          (this.license.limits.maxSessions !== -1 ? ` | max sessions: ${this.license.limits.maxSessions}` : '') +
          (this.license.limits.maxRetentionHours !== -1 ? ` | retention: ${this.license.limits.maxRetentionHours}h` : ' | retention: unlimited')
        );
        resolve();
      });
    });
  }

  async stop(): Promise<void> {
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => resolve());
      } else {
        resolve();
      }
    });
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // SECURITY: Restrict CORS to prevent DNS rebinding attacks.
    // Wildcard (*) would allow any malicious website to query your local collector.
    const ALLOWED_ORIGINS = [
      'http://localhost:3000',        // local UI
      'http://localhost:5173',        // vite dev
      'http://localhost:5500',        // live server
      'http://127.0.0.1:3000',
      'https://ergenekon-dashboard.vercel.app',  // production dashboard
    ];
    const origin = req.headers.origin || '';
    const corsOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : '';

    // Host header validation — reject DNS rebinding
    const host = req.headers.host || '';
    const allowedHosts = ['localhost', '127.0.0.1', '0.0.0.0', 'collector', '::1'];
    // Handle IPv6 bracket format: [::1]:4380 → ::1
    const hostName = host.replace(/^\[|\]$/g, '').split(':')[0] || host.replace(/^\[([^\]]+)\].*/, '$1');
    if (!allowedHosts.includes(hostName)) {
      res.writeHead(403, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Forbidden: invalid Host header' }));
      return;
    }

    // Security headers
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.setHeader('Vary', 'Origin');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0'); // deprecated, use CSP instead
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store'); // session data must not be cached
    res.setHeader('Strict-Transport-Security', 'max-age=63072000; includeSubDomains; preload');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Rate limiting
    // SECURITY: Use rightmost x-forwarded-for IP (set by the LAST proxy, hardest to spoof).
    // Never trust the leftmost value — attacker controls it.
    // If no proxy, use socket.remoteAddress (cannot be spoofed over TCP).
    const forwardedFor = req.headers['x-forwarded-for'] as string | undefined;
    const clientIp = forwardedFor
      ? forwardedFor.split(',').pop()!.trim()
      : req.socket.remoteAddress || 'unknown';
    if (!this.rateLimiter.consume(clientIp)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      res.end(JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }));
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${this.config.port}`);
    const path = url.pathname;

    // ── Auth helper — reused for both read and write operations ───
    const collectorToken = process.env['ERGENEKON_COLLECTOR_TOKEN'];
    const requireAuth = (): boolean => {
      if (!collectorToken) return true; // no token configured = open
      const authHeader = req.headers['authorization'] || '';
      const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      // SECURITY: timingSafeEqual with fixed 64-byte buffers to prevent timing + length oracle
      const tokenBuf = Buffer.alloc(64, 0);
      const inputBuf = Buffer.alloc(64, 0);
      Buffer.from(collectorToken).copy(tokenBuf);
      Buffer.from(bearerToken).copy(inputBuf);
      return timingSafeEqual(tokenBuf, inputBuf) && bearerToken.length === collectorToken.length;
    };

    // ── POST /api/v1/sessions — Receive recordings from probes ────
    // SECURITY (CRIT-01): Require bearer token for write operations
    if (req.method === 'POST' && path === '/api/v1/sessions') {
      if (collectorToken && !requireAuth()) {
        console.warn(`[SECURITY] Unauthorized POST /api/v1/sessions from ${clientIp}`);
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized: invalid or missing collector token' }));
        return;
      } else if (!collectorToken && process.env['NODE_ENV'] === 'production') {
        console.warn('[SECURITY] ERGENEKON_COLLECTOR_TOKEN not set in production. Write operations are unauthenticated!');
      }
      // Layer 1: Safe body read (16MB hard limit, streaming abort)
      let body: string;
      try {
        body = await readBody(req, DEFAULT_MAX_BODY_BYTES);
      } catch (err) {
        if (err instanceof PayloadTooLargeError) {
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: err.message }), () => {
            // Destroy request only after response is fully flushed
            req.destroy();
          });
          return;
        }
        throw err;
      }

      // Layer 2: JSON parse (400, not 500)
      let payload: { sessions: RecordingSession[] };
      try {
        // SECURITY: Prototype pollution guard on incoming session data
        payload = JSON.parse(body, (key, value) => {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
          return value;
        }) as { sessions: RecordingSession[] };
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        return;
      }

      // Layer 3: Schema validation
      if (!payload.sessions || !Array.isArray(payload.sessions)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Missing or invalid "sessions" array' }));
        return;
      }

      if (payload.sessions.length > MAX_SESSIONS_PER_BATCH) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
          error: `Too many sessions in batch: ${payload.sessions.length} exceeds limit of ${MAX_SESSIONS_PER_BATCH}`,
        }));
        return;
      }

      for (const session of payload.sessions) {
        // Layer 4: Session ID validation (prevent path traversal)
        if (!session.id || typeof session.id !== 'string' || !/^[a-zA-Z0-9_\-]{1,128}$/.test(session.id)) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Invalid session ID: must be 1-128 alphanumeric characters` }));
          return;
        }

        // Layer 5: Required field validation
        if (!session.serviceName || typeof session.serviceName !== 'string') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: `Session ${session.id}: missing required field 'serviceName'` }));
          return;
        }

        if (session.events && session.events.length > MAX_EVENTS_PER_SESSION) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: `Session ${session.id} has ${session.events.length} events, exceeds limit of ${MAX_EVENTS_PER_SESSION}`,
          }));
          return;
        }

        try {
          await this.storage.store(session);
        } catch (err) {
          if (err instanceof SessionIdError) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }
          throw err;
        }
        this.sessionsReceived++;
        this.eventsReceived += (session.events?.length ?? 0);
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        stored: payload.sessions.length,
        totalSessions: this.sessionsReceived,
        totalEvents: this.eventsReceived,
      }));
      return;
    }

    // ── GET /api/v1/sessions — List all sessions ──────────────────
    // SECURITY: Session data may contain PII — require auth when token is set
    if (req.method === 'GET' && path === '/api/v1/sessions') {
      if (collectorToken && !requireAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      const sessions = await this.storage.listSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    // ── GET /api/v1/sessions/:id — Get a specific session ─────────
    if (req.method === 'GET' && path.startsWith('/api/v1/sessions/')) {
      if (collectorToken && !requireAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      const sessionId = path.split('/').pop()!;
      // SECURITY: Validate session ID from URL to prevent path traversal
      if (!/^[a-zA-Z0-9_\-]{1,128}$/.test(sessionId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid session ID' }));
        return;
      }
      const session = await this.storage.load(sessionId);

      if (!session) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Session not found' }));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(session));
      return;
    }

    // ── GET /api/v1/traces/:traceId — Get all sessions for a trace ─
    if (req.method === 'GET' && path.startsWith('/api/v1/traces/')) {
      if (collectorToken && !requireAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      const traceId = path.split('/').pop()!;
      // SECURITY: Validate trace ID
      if (!/^[a-zA-Z0-9_\-]{1,128}$/.test(traceId)) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid trace ID' }));
        return;
      }
      const sessions = await this.storage.findByTraceId(traceId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ traceId, sessions }));
      return;
    }

    // ── GET /api/v1/stats — Collector statistics ──────────────────
    if (req.method === 'GET' && path === '/api/v1/stats') {
      if (collectorToken && !requireAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      const sessions = await this.storage.listSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessionsReceived: this.sessionsReceived,
        eventsReceived: this.eventsReceived,
        sessionsStored: sessions.length,
        uptime: process.uptime(),
        license: {
          tier: this.license.tier,
          valid: this.license.valid,
          daysUntilExpiry: this.license.daysUntilExpiry,
          limits: this.license.limits,
        },
      }));
      return;
    }

    // ── GET /api/v1/license — License information ─────────────────
    if (req.method === 'GET' && path === '/api/v1/license') {
      if (collectorToken && !requireAuth()) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        tier: this.license.tier,
        valid: this.license.valid,
        features: this.license.features,
        limits: this.license.limits,
        daysUntilExpiry: this.license.daysUntilExpiry,
        // SECURITY: Do NOT leak customerName to unauthenticated callers
      }));
      return;
    }

    // ── GET /health ───────────────────────────────────────────────
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '0.4.0' }));
      return;
    }

    // ── 404 ───────────────────────────────────────────────────────
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }

  getStorage(): FileStorage {
    return this.storage;
  }
}

