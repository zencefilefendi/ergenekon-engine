// ============================================================================
// PARADOX COLLECTOR — HTTP Server
//
// Receives recording sessions from probes and stores them.
// Provides a REST API for querying and retrieving recordings.
//
// Defense layers:
//   1. readBody() — hard 16MB byte limit, streaming abort → 413
//   2. JSON parse error → 400 Bad Request (not 500)
//   3. Schema validation — events array + length cap
//   4. Future: rate limiting (token bucket), Zod schema
//
// INVARIANT: No request can OOM the collector.
// ============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { RecordingSession } from '@paradox/core';
import { FileStorage } from './storage.js';
import { readBody, PayloadTooLargeError, DEFAULT_MAX_BODY_BYTES } from './body-reader.js';

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

  // Stats
  private sessionsReceived = 0;
  private eventsReceived = 0;

  constructor(config: CollectorServerConfig) {
    this.config = config;
    this.storage = new FileStorage(config.storageDir);
  }

  async start(): Promise<void> {
    await this.storage.init();

    this.server = createServer((req, res) => {
      this.handleRequest(req, res).catch((err) => {
        console.error('[PARADOX COLLECTOR] Unhandled error:', err);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      });
    });

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, () => {
        console.log(
          `[PARADOX COLLECTOR] Listening on port ${this.config.port}\n` +
          `[PARADOX COLLECTOR] Storage: ${this.config.storageDir}`
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
    // CORS headers for UI
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url ?? '/', `http://localhost:${this.config.port}`);
    const path = url.pathname;

    // ── POST /api/v1/sessions — Receive recordings from probes ────
    if (req.method === 'POST' && path === '/api/v1/sessions') {
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
        payload = JSON.parse(body) as { sessions: RecordingSession[] };
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
        if (session.events && session.events.length > MAX_EVENTS_PER_SESSION) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            error: `Session ${session.id} has ${session.events.length} events, exceeds limit of ${MAX_EVENTS_PER_SESSION}`,
          }));
          return;
        }

        await this.storage.store(session);
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
    if (req.method === 'GET' && path === '/api/v1/sessions') {
      const sessions = await this.storage.listSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ sessions }));
      return;
    }

    // ── GET /api/v1/sessions/:id — Get a specific session ─────────
    if (req.method === 'GET' && path.startsWith('/api/v1/sessions/')) {
      const sessionId = path.split('/').pop()!;
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
      const traceId = path.split('/').pop()!;
      const sessions = await this.storage.findByTraceId(traceId);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ traceId, sessions }));
      return;
    }

    // ── GET /api/v1/stats — Collector statistics ──────────────────
    if (req.method === 'GET' && path === '/api/v1/stats') {
      const sessions = await this.storage.listSessions();
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        sessionsReceived: this.sessionsReceived,
        eventsReceived: this.eventsReceived,
        sessionsStored: sessions.length,
        uptime: process.uptime(),
      }));
      return;
    }

    // ── GET /health ───────────────────────────────────────────────
    if (req.method === 'GET' && path === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', version: '0.1.0' }));
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

