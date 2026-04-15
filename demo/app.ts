// ============================================================================
// ERGENEKON ENGINE — Demo Application
//
// A simple Express server instrumented with ERGENEKON probe.
// Demonstrates: HTTP recording, Date.now/Math.random capture,
// external API calls, and request lifecycle tracking.
//
// Run:  npx tsx demo/app.ts
// Test: curl http://localhost:3000/api/users/42
//       curl http://localhost:3000/api/random
//       curl -X POST http://localhost:3000/api/echo -H "Content-Type: application/json" -d '{"msg":"hello"}'
// ============================================================================

import express from 'express';
import { ErgenekonProbe } from '../packages/paradox-probe/src/index.js';
import { CollectorServer } from '../packages/paradox-collector/src/index.js';
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const COLLECTOR_PORT = 4380;
const APP_PORT = 3000;
const RECORDINGS_DIR = join(import.meta.dirname ?? '.', '..', '.ergenekon-recordings');

// ── 1. Start the Collector ───────────────────────────────────────

const collector = new CollectorServer({
  port: COLLECTOR_PORT,
  storageDir: RECORDINGS_DIR,
});
await collector.start();

// ── 2. Create Express App with ERGENEKON Probe ─────────────────────

const app = express();
app.use(express.json());

const probe = new ErgenekonProbe({
  serviceName: 'demo-service',
  collectorUrl: `http://localhost:${COLLECTOR_PORT}`,
  samplingRate: 1.0, // Record everything in demo
});

// Install ERGENEKON middleware FIRST (before routes)
app.use(probe.middleware());

// ── 3. Demo Routes ───────────────────────────────────────────────

// Simple endpoint that uses Date.now() and Math.random()
app.get('/api/random', (req, res) => {
  const timestamp = Date.now();
  const randomValue = Math.random();
  const id = Math.floor(Math.random() * 10000);

  res.json({
    message: 'Random data generated',
    data: {
      timestamp,
      randomValue,
      generatedId: id,
      serverTime: new Date(timestamp).toISOString(),
    },
  });
});

// Endpoint that simulates a user lookup (mock DB)
app.get('/api/users/:id', (req, res) => {
  const userId = req.params['id'];
  const now = Date.now();

  // Simulated "database" lookup
  const users: Record<string, { name: string; email: string; role: string }> = {
    '42': { name: 'Arthur Dent', email: 'arthur@earth.com', role: 'admin' },
    '7': { name: 'James Bond', email: 'bond@mi6.gov.uk', role: 'agent' },
    '1': { name: 'Neo', email: 'neo@matrix.io', role: 'the_one' },
  };

  const user = users[userId];

  if (!user) {
    res.status(404).json({
      error: 'User not found',
      requestedId: userId,
      timestamp: now,
    });
    return;
  }

  res.json({
    user: { id: userId, ...user },
    meta: {
      requestId: Math.random().toString(36).slice(2, 10),
      timestamp: now,
      processingTimeMs: Math.floor(Math.random() * 50) + 5,
    },
  });
});

// Echo endpoint — returns whatever you send
app.post('/api/echo', (req, res) => {
  const received = Date.now();

  res.json({
    echo: req.body,
    meta: {
      receivedAt: received,
      processedAt: Date.now(),
      requestId: Math.random().toString(36).slice(2, 10),
    },
  });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'demo-service', uptime: process.uptime() });
});

// ── 4. Utility: List and export recordings ───────────────────────

app.get('/ergenekon/recordings', async (_req, res) => {
  const sessions = await collector.getStorage().listSessions();
  res.json({
    count: sessions.length,
    sessions,
  });
});

app.get('/ergenekon/recordings/:id', async (req, res) => {
  const session = await collector.getStorage().load(req.params['id']!);
  if (!session) {
    res.status(404).json({ error: 'Recording not found' });
    return;
  }
  res.json(session);
});

// ── 5. Start the server ──────────────────────────────────────────

app.listen(APP_PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    ERGENEKON ENGINE — Demo                     ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║  Demo server:     http://localhost:${APP_PORT}                    ║
║  Collector:       http://localhost:${COLLECTOR_PORT}                    ║
║  Recordings:      ${RECORDINGS_DIR}
║                                                              ║
║  Try these:                                                  ║
║    curl localhost:3000/api/random                             ║
║    curl localhost:3000/api/users/42                           ║
║    curl -X POST localhost:3000/api/echo \\                    ║
║         -H "Content-Type: application/json" \\               ║
║         -d '{"msg":"hello ergenekon"}'                         ║
║                                                              ║
║  View recordings:                                            ║
║    curl localhost:3000/ergenekon/recordings                     ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  await probe.shutdown();
  await collector.stop();
  process.exit(0);
});
