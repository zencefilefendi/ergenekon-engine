// ============================================================================
// ERGENEKON PROBE — Performance Benchmark
//
// Measures the overhead of ERGENEKON instrumentation on real request processing.
//
// Methodology:
// 1. Run N requests WITHOUT the probe (baseline)
// 2. Run N requests WITH the probe (instrumented)
// 3. Calculate overhead: latency added, memory used, events/sec throughput
//
// Run: npx tsx packages/paradox-probe/src/benchmark.ts
// ============================================================================

import { originalDateNow } from './internal-clock.js';

export interface BenchmarkResult {
  /** Benchmark name */
  name: string;
  /** Number of iterations */
  iterations: number;
  /** Total wall time (ms) */
  totalMs: number;
  /** Average time per operation (ms) */
  avgMs: number;
  /** Operations per second */
  opsPerSec: number;
  /** P50 latency (ms) */
  p50: number;
  /** P95 latency (ms) */
  p95: number;
  /** P99 latency (ms) */
  p99: number;
  /** Memory delta (bytes) */
  memoryDeltaBytes: number;
}

/**
 * Run a micro-benchmark: execute fn() N times and measure.
 */
export async function benchmark(
  name: string,
  fn: () => void | Promise<void>,
  iterations: number = 10000
): Promise<BenchmarkResult> {
  // Warmup
  for (let i = 0; i < Math.min(100, iterations / 10); i++) {
    await fn();
  }

  // Force GC if available
  if (global.gc) global.gc();
  const memBefore = process.memoryUsage().heapUsed;

  const latencies: number[] = [];
  const start = originalDateNow();

  for (let i = 0; i < iterations; i++) {
    const opStart = performance.now();
    await fn();
    latencies.push(performance.now() - opStart);
  }

  const totalMs = originalDateNow() - start;
  const memAfter = process.memoryUsage().heapUsed;

  // Sort for percentiles
  latencies.sort((a, b) => a - b);

  return {
    name,
    iterations,
    totalMs,
    avgMs: totalMs / iterations,
    opsPerSec: Math.round(iterations / (totalMs / 1000)),
    p50: latencies[Math.floor(latencies.length * 0.50)]!,
    p95: latencies[Math.floor(latencies.length * 0.95)]!,
    p99: latencies[Math.floor(latencies.length * 0.99)]!,
    memoryDeltaBytes: memAfter - memBefore,
  };
}

/**
 * Pretty-print benchmark results with comparison.
 */
export function printBenchmarkComparison(
  baseline: BenchmarkResult,
  instrumented: BenchmarkResult
): void {
  const overhead = ((instrumented.avgMs - baseline.avgMs) / baseline.avgMs * 100).toFixed(1);
  const p99overhead = ((instrumented.p99 - baseline.p99) / baseline.p99 * 100).toFixed(1);

  console.log(`
╔════════════════════════════════════════════════════════════════╗
║              ERGENEKON Performance Benchmark                     ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║  Metric           Baseline        Instrumented    Overhead     ║
║  ──────────────   ──────────────  ──────────────  ──────────── ║
║  Avg latency      ${pad(baseline.avgMs)}   ${pad(instrumented.avgMs)}   ${overhead.padStart(8)}%   ║
║  P50              ${pad(baseline.p50)}   ${pad(instrumented.p50)}   ${((instrumented.p50 - baseline.p50) / baseline.p50 * 100).toFixed(1).padStart(8)}%   ║
║  P95              ${pad(baseline.p95)}   ${pad(instrumented.p95)}   ${((instrumented.p95 - baseline.p95) / baseline.p95 * 100).toFixed(1).padStart(8)}%   ║
║  P99              ${pad(baseline.p99)}   ${pad(instrumented.p99)}   ${p99overhead.padStart(8)}%   ║
║  Ops/sec          ${String(baseline.opsPerSec).padStart(14)}  ${String(instrumented.opsPerSec).padStart(14)}                ║
║  Memory           ${formatBytes(baseline.memoryDeltaBytes).padStart(14)}  ${formatBytes(instrumented.memoryDeltaBytes).padStart(14)}                ║
║  Iterations       ${String(baseline.iterations).padStart(14)}  ${String(instrumented.iterations).padStart(14)}                ║
║                                                                ║
║  ${Number(overhead) < 5 ? '✅ Overhead < 5%' : Number(overhead) < 10 ? '⚠️  Overhead 5-10%' : '❌ Overhead > 10%'} — ${Number(overhead) < 5 ? 'Production-safe!' : 'Needs optimization'}${' '.repeat(Math.max(0, 31 - (Number(overhead) < 5 ? 'Production-safe!' : 'Needs optimization').length))}║
╚════════════════════════════════════════════════════════════════╝
`);
}

function pad(ms: number): string {
  return `${ms.toFixed(3)}ms`.padStart(14);
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1048576).toFixed(1)}MB`;
}

// ── Self-contained benchmark runner ───────────────────────────────

async function runSelfBenchmark(): Promise<void> {
  console.log('\nERGENEKON Probe Overhead Benchmark\n');
  console.log('Measuring Date.now() interception overhead...\n');

  // Store original
  const rawDateNow = Date.now.bind(Date);

  // Benchmark 1: Raw Date.now
  const baselineResult = await benchmark('Date.now (raw)', () => {
    rawDateNow();
  }, 100_000);

  // Benchmark 2: Patched Date.now (with probe active but no session)
  // This tests the "fast path" — no recording context
  const { installGlobalInterceptors, uninstallGlobalInterceptors } = await import('./interceptors/globals.js');
  installGlobalInterceptors();

  const instrumentedResult = await benchmark('Date.now (patched, no session)', () => {
    Date.now();
  }, 100_000);

  uninstallGlobalInterceptors();

  printBenchmarkComparison(baselineResult, instrumentedResult);

  // Benchmark 3: Math.random
  console.log('Measuring Math.random() interception overhead...\n');

  const rawRandom = Math.random.bind(Math);
  const randomBaseline = await benchmark('Math.random (raw)', () => {
    rawRandom();
  }, 100_000);

  installGlobalInterceptors();
  const randomInstrumented = await benchmark('Math.random (patched, no session)', () => {
    Math.random();
  }, 100_000);
  uninstallGlobalInterceptors();

  printBenchmarkComparison(randomBaseline, randomInstrumented);

  // Benchmark 4: Redaction
  console.log('Measuring deep redaction overhead...\n');
  const { redactDeep } = await import('./redaction.js');

  const samplePayload = {
    user: { name: 'Test', email: 'test@test.com', password: 'secret123', creditCard: '4111111111111111' },
    items: Array.from({ length: 10 }, (_, i) => ({
      id: i, name: `Item ${i}`, price: Math.random() * 100,
      meta: { token: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.test' }
    })),
  };

  const noRedaction = await benchmark('JSON (no redaction)', () => {
    JSON.parse(JSON.stringify(samplePayload));
  }, 10_000);

  const withRedaction = await benchmark('JSON (with redaction)', () => {
    redactDeep(samplePayload);
  }, 10_000);

  printBenchmarkComparison(noRedaction, withRedaction);
}

// Run if executed directly
const isMain = process.argv[1]?.includes('benchmark');
if (isMain) {
  runSelfBenchmark().catch(console.error);
}
