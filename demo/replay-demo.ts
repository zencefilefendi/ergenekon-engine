// ============================================================================
// ERGENEKON ENGINE — Replay Demo
//
// Demonstrates the core magic: recording a request and replaying it
// deterministically, producing the EXACT same result.
//
// This is the "wow moment" — proving that time-travel debugging works.
//
// Run: npx tsx demo/replay-demo.ts
// ============================================================================

import express from 'express';
import { ErgenekonProbe } from '../packages/paradox-probe/src/index.js';
import { ReplayEngine } from '../packages/paradox-replay/src/index.js';
import type { RecordingSession } from '../packages/paradox-core/src/index.js';

console.log(`
╔══════════════════════════════════════════════════════════════╗
║            ERGENEKON ENGINE — Replay Demonstration             ║
╠══════════════════════════════════════════════════════════════╣
║  Step 1: Record a request                                    ║
║  Step 2: Replay it deterministically                         ║
║  Step 3: Prove the results are IDENTICAL                     ║
╚══════════════════════════════════════════════════════════════╝
`);

// ── Step 1: Create an app and record a request ───────────────────

console.log('━━━ STEP 1: RECORDING ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Creating Express app with ERGENEKON probe...\n');

const app = express();
app.use(express.json());

const probe = new ErgenekonProbe({
  serviceName: 'replay-demo-service',
  collectorUrl: 'http://localhost:4380', // won't actually connect in local mode
});
probe.enableLocalMode();

app.use(probe.middleware());

// A route that uses multiple non-deterministic operations
app.get('/api/compute', (req, res) => {
  const startTime = Date.now();
  const requestId = Math.random().toString(36).slice(2, 10);
  const score = Math.floor(Math.random() * 100);
  const processingTime = Date.now() - startTime;

  res.json({
    requestId,
    score,
    grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F',
    computedAt: startTime,
    processingTimeMs: processingTime,
    message: `Your score is ${score}. Request ID: ${requestId}`,
  });
});

// Start the server
const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
  const s = app.listen(0, () => resolve(s)); // Port 0 = random available port
});
const port = (server.address() as { port: number }).port;

// Make a request to record
console.log(`Server running on port ${port}. Making request to record...\n`);

const response = await fetch(`http://localhost:${port}/api/compute`);
const originalResult = await response.json();

console.log('Original Response:');
console.log(JSON.stringify(originalResult, null, 2));
console.log();

// Wait a tiny bit for the probe to capture the response event
await new Promise((r) => setTimeout(r, 100));

// Get the recording
const recordings = probe.getRecordings();
console.log(`Captured ${recordings.length} recording(s) with ${recordings[0]?.events.length ?? 0} events.\n`);

if (recordings.length === 0) {
  console.error('ERROR: No recordings captured!');
  server.close();
  process.exit(1);
}

const recording = recordings[0]!;

// Print the event timeline
console.log('Event Timeline:');
console.log('─'.repeat(70));
for (const event of recording.events) {
  const typeLabel = event.type.padEnd(20);
  const seqLabel = `#${event.sequence}`.padStart(4);
  console.log(`  ${seqLabel}  ${typeLabel}  ${event.operationName}`);

  // Show captured values for non-deterministic events
  if (event.type === 'timestamp') {
    console.log(`        └─ value: ${event.data['value']}`);
  } else if (event.type === 'random') {
    console.log(`        └─ value: ${event.data['value']}`);
  }
}
console.log('─'.repeat(70));

// ── Step 2: Replay the recording ─────────────────────────────────

console.log('\n━━━ STEP 2: REPLAY ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Loading recording into replay engine...\n');

const engine = new ReplayEngine();
engine.loadFromSession(recording);

// Get mock layer for manual replay
const mockLayer = engine.getMockLayer();

// We'll manually simulate what the route handler does,
// but with mocked Date.now() and Math.random()
console.log('Replaying with mocked I/O...\n');

// Save originals
const origDateNow = Date.now;
const origMathRandom = Math.random;

// Install mocks
Date.now = () => mockLayer.mockDateNow();
Math.random = () => mockLayer.mockMathRandom();

// Skip the http_request_in event (consumed by the middleware)
mockLayer.nextOfType('http_request_in');

// Re-execute the EXACT same logic as the route handler
const startTime = Date.now();
const requestId = Math.random().toString(36).slice(2, 10);
const score = Math.floor(Math.random() * 100);
const processingTime = Date.now() - startTime;

const replayedResult = {
  requestId,
  score,
  grade: score >= 90 ? 'A' : score >= 80 ? 'B' : score >= 70 ? 'C' : score >= 60 ? 'D' : 'F',
  computedAt: startTime,
  processingTimeMs: processingTime,
  message: `Your score is ${score}. Request ID: ${requestId}`,
};

// Restore originals
Date.now = origDateNow;
Math.random = origMathRandom;

console.log('Replayed Response:');
console.log(JSON.stringify(replayedResult, null, 2));
console.log();

// ── Step 3: Compare ──────────────────────────────────────────────

console.log('━━━ STEP 3: VERIFICATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

const originalJson = JSON.stringify(originalResult);
const replayedJson = JSON.stringify(replayedResult);
const identical = originalJson === replayedJson;

if (identical) {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ✅  PERFECT REPLAY — Results are BYTE-FOR-BYTE IDENTICAL   ║
║                                                              ║
║   Original:  ${originalResult.requestId.padEnd(41)} ║
║   Replayed:  ${replayedResult.requestId.padEnd(41)} ║
║   Score:     ${String(originalResult.score).padEnd(41)} ║
║                                                              ║
║   Date.now() → deterministic ✓                               ║
║   Math.random() → deterministic ✓                            ║
║   Response body → identical ✓                                ║
║                                                              ║
║   This is the foundation of time-travel debugging.           ║
║   If we can replay I/O deterministically, we can replay      ║
║   ANYTHING — including distributed microservice bugs.        ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
} else {
  console.log('\n❌ REPLAY DIVERGENCE DETECTED\n');
  console.log('Original: ', originalJson);
  console.log('Replayed: ', replayedJson);

  // Find specific differences
  for (const key of Object.keys(originalResult)) {
    if (JSON.stringify(originalResult[key]) !== JSON.stringify(replayedResult[key as keyof typeof replayedResult])) {
      console.log(`  DIFF in "${key}": ${JSON.stringify(originalResult[key])} vs ${JSON.stringify(replayedResult[key as keyof typeof replayedResult])}`);
    }
  }
}

// ── Timeline inspection demo ─────────────────────────────────────

console.log('\n━━━ BONUS: TIME-TRAVEL INSPECTION ━━━━━━━━━━━━━━━━━━━━━━━━━');
const timeline = engine.getTimeline();
console.log(`\nTimeline has ${timeline.length} events spanning ${timeline.length > 0 ? timeline[timeline.length - 1]!.wallClock - timeline[0]!.wallClock : 0}ms\n`);

for (const snapshot of timeline) {
  const bar = '█'.repeat(Math.max(1, Math.min(20, snapshot.durationMs)));
  console.log(`  [${String(snapshot.sequence).padStart(2)}] ${snapshot.type.padEnd(20)} ${bar} ${snapshot.operation}`);
}

// Cleanup
server.close();
await probe.shutdown();

console.log('\nDemo complete. The future of debugging starts here. 🚀\n');
process.exit(0);
