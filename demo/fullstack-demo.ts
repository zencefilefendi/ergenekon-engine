// ============================================================================
// ERGENEKON ENGINE — Full-Stack Demo
//
// Starts everything together:
//   1. Collector (port 4380) — receives and stores recordings
//   2. User Service (port 3002) — upstream API
//   3. Order Service (port 3001) — downstream, calls User Service
//   4. Time-Travel UI (port 3000) — visual debugger
//
// Then makes sample requests to generate recordings.
//
// Run: npx tsx demo/fullstack-demo.ts
// Open: http://localhost:3000
// ============================================================================

import express from 'express';
import { ErgenekonProbe } from '../packages/paradox-probe/src/index.js';
import { CollectorServer } from '../packages/paradox-collector/src/index.js';
import { join } from 'node:path';

const RECORDINGS_DIR = join(import.meta.dirname ?? '.', '..', '.ergenekon-recordings');

console.log(`
╔══════════════════════════════════════════════════════════════╗
║          ERGENEKON ENGINE — Full-Stack Demo                    ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║   Launching: Collector + 2 Services + Time-Travel UI         ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

// ── 1. Start Collector ───────────────────────────────────────────

const collector = new CollectorServer({
  port: 4380,
  storageDir: RECORDINGS_DIR,
});
await collector.start();

// ── 2. Start User Service ────────────────────────────────────────

const userApp = express();
userApp.use(express.json());

const userProbe = new ErgenekonProbe({
  serviceName: 'user-service',
  collectorUrl: 'http://localhost:4380',
});
userApp.use(userProbe.middleware());

const users: Record<string, { name: string; email: string; credit: number; role: string }> = {
  '1': { name: 'Ahmet Yilmaz', email: 'ahmet@ergenekon.dev', credit: 1500, role: 'admin' },
  '2': { name: 'Ayse Demir', email: 'ayse@ergenekon.dev', credit: 3200, role: 'user' },
  '3': { name: 'Mehmet Kaya', email: 'mehmet@ergenekon.dev', credit: 750, role: 'user' },
  '4': { name: 'Fatma Celik', email: 'fatma@ergenekon.dev', credit: 50, role: 'user' },
};

userApp.get('/api/users/:id', (req, res) => {
  const userId = req.params['id']!;
  const lookupTime = Date.now();
  const user = users[userId];

  if (!user) {
    res.status(404).json({ error: 'User not found', userId, timestamp: lookupTime });
    return;
  }

  res.json({
    user: { id: userId, ...user },
    meta: { lookupTime, requestToken: Math.random().toString(36).slice(2, 10) },
  });
});

userApp.get('/api/users', (_req, res) => {
  res.json({ users: Object.entries(users).map(([id, u]) => ({ id, ...u })) });
});

const userServer = userApp.listen(3002, () => {
  console.log('[USER SERVICE] Running on http://localhost:3002');
});

// ── 3. Start Order Service ───────────────────────────────────────

const orderApp = express();
orderApp.use(express.json());

const orderProbe = new ErgenekonProbe({
  serviceName: 'order-service',
  collectorUrl: 'http://localhost:4380',
});
orderApp.use(orderProbe.middleware());

orderApp.post('/api/orders', async (req, res) => {
  const orderTime = Date.now();
  const orderId = `ORD-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const userId = req.body?.userId ?? '1';

  // Call User Service
  const userResponse = await fetch(`http://localhost:3002/api/users/${userId}`);
  const userData = await userResponse.json() as Record<string, unknown>;

  if (!userResponse.ok) {
    res.status(400).json({ error: 'User not found', orderId, userId });
    return;
  }

  const user = userData['user'] as { name: string; credit: number };
  const orderTotal = Math.floor(Math.random() * 500) + 50;
  const hasCredit = user.credit >= orderTotal;

  res.json({
    orderId,
    userId,
    userName: user.name,
    orderTotal,
    status: hasCredit ? 'confirmed' : 'rejected',
    reason: hasCredit ? null : 'Insufficient credit',
    timestamp: orderTime,
    confirmationCode: hasCredit ? Math.random().toString(36).slice(2, 10).toUpperCase() : null,
  });
});

orderApp.get('/api/orders/health', (_req, res) => {
  res.json({ status: 'ok', service: 'order-service' });
});

const orderServer = orderApp.listen(3001, () => {
  console.log('[ORDER SERVICE] Running on http://localhost:3001');
});

// ── 4. Start Time-Travel UI ─────────────────────────────────────

// Set UI port before importing
process.env['ERGENEKON_UI_PORT'] = '3000';
process.env['ERGENEKON_COLLECTOR_URL'] = 'http://localhost:4380';
await import('../packages/paradox-ui/src/server.js');

// ── 5. Generate Sample Recordings ────────────────────────────────

console.log('\nGenerating sample recordings...\n');

// A few different scenarios
const scenarios = [
  { userId: '1', desc: 'Admin order (high credit)' },
  { userId: '2', desc: 'Regular user order' },
  { userId: '4', desc: 'Low credit user (may reject)' },
  { userId: '99', desc: 'Non-existent user (error)' },
  { userId: '3', desc: 'Another regular order' },
];

for (const scenario of scenarios) {
  try {
    const resp = await fetch('http://localhost:3001/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: scenario.userId, item: 'ERGENEKON License' }),
    });
    const result = await resp.json() as Record<string, unknown>;
    const status = result['status'] || result['error'] || 'unknown';
    console.log(`  ${scenario.desc}: ${status}`);
  } catch (err) {
    console.log(`  ${scenario.desc}: ERROR - ${err}`);
  }
  await new Promise(r => setTimeout(r, 100)); // Small delay between requests
}

console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ERGENEKON is running!                                        ║
║                                                              ║
║   Time-Travel UI:  http://localhost:3000                     ║
║   Order Service:   http://localhost:3001                     ║
║   User Service:    http://localhost:3002                     ║
║   Collector:       http://localhost:4380                     ║
║                                                              ║
║   Open the UI and explore the recordings!                    ║
║   Click any recording → scrub the timeline → inspect events  ║
║                                                              ║
║   Keyboard shortcuts:                                        ║
║     ← / → or j/k   Step through events                      ║
║     Space           Play/pause                               ║
║     Home / End      Jump to first/last event                 ║
║                                                              ║
║   Generate more recordings:                                  ║
║     curl -X POST localhost:3001/api/orders \\                ║
║       -H "Content-Type: application/json" \\                 ║
║       -d '{"userId":"2"}'                                    ║
║                                                              ║
║   Press Ctrl+C to stop.                                      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');
  userServer.close();
  orderServer.close();
  await userProbe.shutdown();
  await orderProbe.shutdown();
  await collector.stop();
  process.exit(0);
});
