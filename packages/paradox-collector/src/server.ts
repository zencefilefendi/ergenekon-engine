// ============================================================================
// PARADOX COLLECTOR — HTTP Server
//
// Receives recording sessions from probes and stores them.
// Provides a REST API for querying and retrieving recordings.
//
// Phase 0: Simple Node.js HTTP server (no framework dependency).
// Future: gRPC for high-throughput ingestion.
// ============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { RecordingSession } from '@paradox/core';
import { FileStorage } from './storage.js';

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
      const body = await readBody(req);
      const payload = JSON.parse(body) as { sessions: RecordingSession[] };

      for (const session of payload.sessions) {
        await this.storage.store(session);
        this.sessionsReceived++;
        this.eventsReceived += session.events.length;
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

/** Read request body as string */
function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}
