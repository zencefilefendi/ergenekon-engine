#!/usr/bin/env node
// ============================================================================
// ERGENEKON CLI — Command-line interface for the ERGENEKON Engine
//
// Commands:
//   ergenekon sessions                  — List all recorded sessions
//   ergenekon inspect <sessionId>       — Show detailed session info
//   ergenekon timeline <sessionId>      — Print event timeline (ASCII)
//   ergenekon trace <traceId>           — Show all sessions in a distributed trace
//   ergenekon export <sessionId> [file] — Export session (JSON or binary)
//   ergenekon import <file>             — Import session into collector
//   ergenekon replay <sessionId>        — Replay a session and verify determinism
//   ergenekon stats                     — Show collector statistics
//   ergenekon watch                     — Live-tail new recordings
//   ergenekon health                    — Check collector health
//
// Usage:
//   npx tsx packages/ergenekon-cli/src/index.ts sessions
//   npx ergenekon sessions  (after npm link)
// ============================================================================

import { readFileSync, writeFileSync } from 'node:fs';
import {
  exportSessionJSON,
  exportSessionBinary,
  importSessionsJSON,
  importSessionBinary,
} from '@ergenekon/core';
import type { RecordingSession, ErgenekonEvent } from '@ergenekon/core';

// ── Config ────────────────────────────────────────────────────────

const COLLECTOR_URL = process.env['ERGENEKON_COLLECTOR_URL'] || 'http://localhost:4380';

// ── Color helpers (ANSI) ──────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  gray: '\x1b[90m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
};

function colorForEventType(type: string): string {
  switch (type) {
    case 'http_request_in':
    case 'http_response_out': return c.blue;
    case 'http_request_out':
    case 'http_response_in': return c.cyan;
    case 'db_query':
    case 'db_result': return c.green;
    case 'cache_get':
    case 'cache_set': return c.green;
    case 'random':
    case 'timestamp':
    case 'uuid': return c.yellow;
    case 'timer_set':
    case 'timer_fire': return c.magenta;
    case 'error': return c.red;
    default: return c.white;
  }
}

// ── API helpers ───────────────────────────────────────────────────

async function fetchAPI(path: string): Promise<unknown> {
  const resp = await fetch(`${COLLECTOR_URL}${path}`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) {
    throw new Error(`Collector returned ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

async function postAPI(path: string, body: unknown): Promise<unknown> {
  const resp = await fetch(`${COLLECTOR_URL}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
  if (!resp.ok) {
    throw new Error(`Collector returned ${resp.status}: ${await resp.text()}`);
  }
  return resp.json();
}

// ── Commands ──────────────────────────────────────────────────────

// Session summary type (from collector's listSessions)
interface SessionSummary {
  id: string;
  traceId: string;
  serviceName: string;
  startedAt: number;
  endedAt: number;
  eventCount: number;
  hasError: boolean;
}

async function cmdSessions(): Promise<void> {
  const data = await fetchAPI('/api/v1/sessions') as { sessions: SessionSummary[] };
  const sessions = data.sessions;

  if (sessions.length === 0) {
    console.log(`${c.yellow}No recordings found.${c.reset} Generate some traffic first.`);
    return;
  }

  console.log(`\n${c.bold}📼 Recorded Sessions (${sessions.length})${c.reset}\n`);
  console.log(`${'ID'.padEnd(28)} ${'Service'.padEnd(18)} ${'Events'.padEnd(8)} ${'Duration'.padEnd(10)} ${'Error'.padEnd(6)} Time`);
  console.log(`${'─'.repeat(28)} ${'─'.repeat(18)} ${'─'.repeat(8)} ${'─'.repeat(10)} ${'─'.repeat(6)} ${'─'.repeat(24)}`);

  for (const s of sessions) {
    const errorMark = s.hasError ? `${c.red}✗${c.reset}` : `${c.green}✓${c.reset}`;
    const duration = `${s.endedAt - s.startedAt}ms`;
    const time = new Date(s.startedAt).toLocaleString();
    const idShort = s.id.slice(0, 26);

    console.log(
      `${c.cyan}${idShort}${c.reset} ${s.serviceName.padEnd(18)} ${String(s.eventCount).padEnd(8)} ${duration.padEnd(10)} ${errorMark.padEnd(6)}    ${c.dim}${time}${c.reset}`
    );
  }
  console.log();
}

async function cmdInspect(sessionId: string): Promise<void> {
  const s = await fetchAPI(`/api/v1/sessions/${sessionId}`) as RecordingSession;

  console.log(`\n${c.bold}🔍 Session: ${s.id}${c.reset}\n`);
  console.log(`  Service:   ${c.cyan}${s.serviceName}${c.reset}`);
  console.log(`  Trace ID:  ${c.dim}${s.traceId}${c.reset}`);
  console.log(`  Started:   ${new Date(s.startedAt).toISOString()}`);
  console.log(`  Ended:     ${new Date(s.endedAt).toISOString()}`);
  console.log(`  Duration:  ${c.yellow}${s.metadata.totalDurationMs}ms${c.reset}`);
  console.log(`  Events:    ${c.bold}${s.events.length}${c.reset}`);
  console.log(`  Has Error: ${s.metadata.hasError ? `${c.red}YES${c.reset}` : `${c.green}NO${c.reset}`}`);
  console.log(`  Node:      ${s.metadata.nodeVersion}`);
  console.log(`  Platform:  ${s.metadata.platform}`);

  // Event type breakdown
  const typeCounts = new Map<string, number>();
  for (const e of s.events) {
    typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
  }

  console.log(`\n  ${c.bold}Event Breakdown:${c.reset}`);
  for (const [type, count] of [...typeCounts.entries()].sort((a, b) => b[1] - a[1])) {
    const color = colorForEventType(type);
    const bar = '█'.repeat(Math.min(count, 40));
    console.log(`    ${color}${type.padEnd(22)}${c.reset} ${String(count).padStart(4)} ${c.dim}${bar}${c.reset}`);
  }
  console.log();
}

async function cmdTimeline(sessionId: string): Promise<void> {
  const s = await fetchAPI(`/api/v1/sessions/${sessionId}`) as RecordingSession;

  console.log(`\n${c.bold}⏱  Timeline: ${s.serviceName} (${s.events.length} events)${c.reset}\n`);

  const startTime = s.startedAt;

  for (const event of s.events) {
    const relativeMs = event.wallClock - startTime;
    const color = colorForEventType(event.type);
    const seq = String(event.sequence).padStart(3, '0');
    const time = `+${relativeMs}ms`.padStart(8);
    const dur = event.durationMs > 0 ? ` ${c.dim}(${event.durationMs}ms)${c.reset}` : '';
    const err = event.error ? ` ${c.red}⚠ ${event.error.message}${c.reset}` : '';

    console.log(
      `  ${c.dim}${seq}${c.reset} ${c.gray}${time}${c.reset} ${color}● ${event.type.padEnd(20)}${c.reset} ${event.operationName}${dur}${err}`
    );
  }
  console.log();
}

async function cmdTrace(traceId: string): Promise<void> {
  const data = await fetchAPI(`/api/v1/traces/${traceId}`) as { sessions: RecordingSession[] };
  const sessions = data.sessions;

  if (sessions.length === 0) {
    console.log(`${c.yellow}No sessions found for trace: ${traceId}${c.reset}`);
    return;
  }

  console.log(`\n${c.bold}🔗 Distributed Trace: ${traceId}${c.reset}`);
  console.log(`  Services: ${sessions.length}\n`);

  // Sort by startedAt
  sessions.sort((a, b) => a.startedAt - b.startedAt);
  const globalStart = sessions[0]!.startedAt;

  for (const s of sessions) {
    const offset = s.startedAt - globalStart;
    const indent = Math.floor(offset / 10); // 1 char per 10ms
    const bar = '═'.repeat(Math.max(1, Math.floor(s.metadata.totalDurationMs / 10)));
    const errorMark = s.metadata.hasError ? ` ${c.red}[ERROR]${c.reset}` : '';

    console.log(
      `  ${c.cyan}${s.serviceName.padEnd(18)}${c.reset} ${' '.repeat(Math.min(indent, 40))}${c.green}╠${bar}╣${c.reset} ${s.metadata.totalDurationMs}ms ${c.dim}(${s.events.length} events)${c.reset}${errorMark}`
    );
  }

  console.log(`\n  ${c.dim}Total span: ${sessions[sessions.length - 1]!.endedAt - globalStart}ms${c.reset}\n`);
}

async function cmdExport(sessionId: string, outputFile?: string): Promise<void> {
  const session = await fetchAPI(`/api/v1/sessions/${sessionId}`) as RecordingSession;

  const isBinary = outputFile?.endsWith('.bin') || outputFile?.endsWith('.ergenekon.bin');

  if (isBinary && outputFile) {
    const buf = exportSessionBinary(session);
    writeFileSync(outputFile, buf);
    const jsonSize = JSON.stringify(session).length;
    const ratio = ((1 - buf.length / jsonSize) * 100).toFixed(0);
    console.log(`${c.green}✓${c.reset} Exported to ${c.bold}${outputFile}${c.reset} (${buf.length} bytes, ${ratio}% smaller than JSON)`);
  } else {
    const json = exportSessionJSON(session, { pretty: true });
    const file = outputFile || `${sessionId}.ergenekon.json`;
    writeFileSync(file, json);
    console.log(`${c.green}✓${c.reset} Exported to ${c.bold}${file}${c.reset} (${json.length} bytes)`);
  }
}

async function cmdImport(inputFile: string): Promise<void> {
  const raw = readFileSync(inputFile);

  let sessions: RecordingSession[];

  if (inputFile.endsWith('.bin') || inputFile.endsWith('.ergenekon.bin')) {
    sessions = [importSessionBinary(raw)];
  } else {
    sessions = importSessionsJSON(raw.toString('utf-8'));
  }

  await postAPI('/api/v1/sessions', { sessions });
  console.log(`${c.green}✓${c.reset} Imported ${c.bold}${sessions.length}${c.reset} session(s) from ${inputFile}`);
}

async function cmdStats(): Promise<void> {
  const data = await fetchAPI('/api/v1/stats') as Record<string, unknown>;

  console.log(`\n${c.bold}📊 Collector Statistics${c.reset}\n`);
  for (const [key, value] of Object.entries(data)) {
    console.log(`  ${key.padEnd(24)} ${c.cyan}${JSON.stringify(value)}${c.reset}`);
  }
  console.log();
}

async function cmdWatch(): Promise<void> {
  console.log(`\n${c.bold}👀 Watching for new recordings...${c.reset} (Ctrl+C to stop)\n`);

  let knownIds = new Set<string>();

  // Initial load
  const initial = await fetchAPI('/api/v1/sessions') as { sessions: SessionSummary[] };
  for (const s of initial.sessions) {
    knownIds.add(s.id);
  }

  // Poll every 2 seconds
  const poll = async () => {
    try {
      const data = await fetchAPI('/api/v1/sessions') as { sessions: SessionSummary[] };
      for (const s of data.sessions) {
        if (!knownIds.has(s.id)) {
          knownIds.add(s.id);
          const errorMark = s.hasError ? `${c.red} [ERROR]${c.reset}` : '';
          const time = new Date(s.startedAt).toLocaleTimeString();
          console.log(
            `  ${c.green}NEW${c.reset} ${c.dim}${time}${c.reset} ${c.cyan}${s.serviceName}${c.reset} — ${s.eventCount} events, ${s.endedAt - s.startedAt}ms${errorMark}`
          );
        }
      }
    } catch {
      // Silent — collector might be restarting
    }
  };

  setInterval(poll, 2000);
}

async function cmdHealth(): Promise<void> {
  try {
    const data = await fetchAPI('/health') as Record<string, unknown>;
    console.log(`${c.green}✓${c.reset} Collector at ${c.bold}${COLLECTOR_URL}${c.reset} is ${c.green}healthy${c.reset}`);
    if (data['uptime']) {
      console.log(`  Uptime: ${Math.round(Number(data['uptime']) / 1000)}s`);
    }
  } catch (err) {
    console.log(`${c.red}✗${c.reset} Collector at ${c.bold}${COLLECTOR_URL}${c.reset} is ${c.red}unreachable${c.reset}`);
    console.log(`  ${c.dim}${err}${c.reset}`);
    process.exit(1);
  }
}

// ── Help ──────────────────────────────────────────────────────────

// ── Doctor ────────────────────────────────────────────────────────

interface DoctorCheck {
  name: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  detail?: string;
}

async function cmdDoctor(): Promise<void> {
  console.log(`\n${c.bold}╔══════════════════════════════════════════╗`);
  console.log(`║       ERGENEKON DOCTOR — System Check      ║`);
  console.log(`╚══════════════════════════════════════════╝${c.reset}\n`);

  const checks: DoctorCheck[] = [];

  // 1. Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0]!, 10);
  checks.push({
    name: 'Node.js version',
    status: major >= 18 ? 'pass' : major >= 16 ? 'warn' : 'fail',
    message: nodeVersion,
    detail: major < 18 ? 'Recommended: Node.js >= 18.0.0 for full AsyncLocalStorage support' : undefined,
  });

  // 2. ERGENEKON_STRICT env
  const strict = process.env['ERGENEKON_STRICT'];
  checks.push({
    name: 'ERGENEKON_STRICT mode',
    status: strict === '1' ? 'pass' : 'warn',
    message: strict === '1' ? 'Enabled (strict error handling)' : 'Not set (errors may be silently handled)',
    detail: strict !== '1' ? 'Set ERGENEKON_STRICT=1 in CI to catch errors early' : undefined,
  });

  // 3. Collector reachability
  try {
    const health = await fetchAPI('/health') as any;
    checks.push({
      name: 'Collector connection',
      status: health.status === 'ok' ? 'pass' : 'warn',
      message: `Connected to ${COLLECTOR_URL} (v${health.version || 'unknown'})`,
    });
  } catch (err) {
    checks.push({
      name: 'Collector connection',
      status: 'fail',
      message: `Cannot reach ${COLLECTOR_URL}`,
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 4. Collector stats
  try {
    const stats = await fetchAPI('/api/v1/stats') as any;
    checks.push({
      name: 'Collector stats',
      status: 'pass',
      message: `${stats.sessionsStored} sessions stored, ${stats.eventsReceived} events received`,
    });
  } catch {
    checks.push({
      name: 'Collector stats',
      status: 'warn',
      message: 'Could not fetch stats (collector may be unreachable)',
    });
  }

  // 5. Storage directory writable
  const { mkdtemp, writeFile, unlink, rmdir } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  try {
    const testDir = await mkdtemp(join(tmpdir(), 'ergenekon-doctor-'));
    const testFile = join(testDir, 'test-write');
    await writeFile(testFile, 'ergenekon-doctor-test');
    await unlink(testFile);
    await rmdir(testDir);
    checks.push({
      name: 'Storage writable',
      status: 'pass',
      message: 'Temp storage write + fsync test passed',
    });
  } catch (err) {
    checks.push({
      name: 'Storage writable',
      status: 'fail',
      message: 'Cannot write to temp directory',
      detail: err instanceof Error ? err.message : String(err),
    });
  }

  // 6. Clock check (NTP-like sanity)
  const before = Date.now();
  const after = Date.now();
  const clockDrift = after - before;
  checks.push({
    name: 'System clock',
    status: clockDrift <= 100 ? 'pass' : 'warn',
    message: `Clock monotonic (${clockDrift}ms between successive calls)`,
    detail: clockDrift > 100 ? 'High clock jitter detected — HLC may compensate but investigate NTP sync' : undefined,
  });

  // 7. Memory check
  const mem = process.memoryUsage();
  const heapMB = Math.round(mem.heapUsed / 1024 / 1024);
  checks.push({
    name: 'Memory usage',
    status: heapMB < 512 ? 'pass' : heapMB < 1024 ? 'warn' : 'fail',
    message: `${heapMB}MB heap used`,
  });

  // 8. Package availability checks
  const packages = ['@ergenekon/core', '@ergenekon/probe', '@ergenekon/replay', '@ergenekon/collector'];
  for (const pkg of packages) {
    try {
      await import(pkg);
      checks.push({ name: `Package: ${pkg}`, status: 'pass', message: 'Loaded' });
    } catch {
      checks.push({ name: `Package: ${pkg}`, status: 'warn', message: 'Not found in current context' });
    }
  }

  // ── Print results ──────────────────────────────────────────────

  const icons = { pass: `${c.green}✓${c.reset}`, fail: `${c.red}✗${c.reset}`, warn: `${c.yellow}⚠${c.reset}` };

  for (const check of checks) {
    console.log(`  ${icons[check.status]} ${c.bold}${check.name}${c.reset}: ${check.message}`);
    if (check.detail) {
      console.log(`    ${c.dim}${check.detail}${c.reset}`);
    }
  }

  const passCount = checks.filter(ch => ch.status === 'pass').length;
  const failCount = checks.filter(ch => ch.status === 'fail').length;
  const warnCount = checks.filter(ch => ch.status === 'warn').length;

  console.log(`\n${c.bold}Summary:${c.reset} ${c.green}${passCount} passed${c.reset}, ${c.yellow}${warnCount} warnings${c.reset}, ${c.red}${failCount} failed${c.reset}`);

  if (failCount > 0) {
    console.log(`\n${c.bgRed}${c.white} UNHEALTHY ${c.reset} Fix the failed checks above before running in production.\n`);
    process.exitCode = 1;
  } else if (warnCount > 0) {
    console.log(`\n${c.bgYellow} MOSTLY OK ${c.reset} Some warnings — review before production deployment.\n`);
  } else {
    console.log(`\n${c.bgGreen}${c.white} ALL CLEAR ${c.reset} System is healthy and ready.\n`);
  }
}

function showHelp(): void {
  console.log(`
${c.bold}╔══════════════════════════════════════════╗
║        ERGENEKON CLI — Time-Travel         ║
╚══════════════════════════════════════════╝${c.reset}

${c.bold}Usage:${c.reset}  ergenekon <command> [options]

${c.bold}Commands:${c.reset}
  ${c.cyan}sessions${c.reset}                      List all recorded sessions
  ${c.cyan}inspect${c.reset}  <sessionId>           Show detailed session info
  ${c.cyan}timeline${c.reset} <sessionId>           Print ASCII event timeline
  ${c.cyan}trace${c.reset}    <traceId>             Show distributed trace
  ${c.cyan}export${c.reset}   <sessionId> [file]    Export session (.json or .bin)
  ${c.cyan}import${c.reset}   <file>                Import session into collector
  ${c.cyan}stats${c.reset}                          Show collector statistics
  ${c.cyan}watch${c.reset}                          Live-tail new recordings
  ${c.cyan}health${c.reset}                         Check collector health
  ${c.cyan}doctor${c.reset}                         Run diagnostic checks on the system

${c.bold}Environment:${c.reset}
  ERGENEKON_COLLECTOR_URL   Collector address (default: http://localhost:4380)

${c.bold}Examples:${c.reset}
  ${c.dim}ergenekon sessions${c.reset}
  ${c.dim}ergenekon inspect 01HXYZ...${c.reset}
  ${c.dim}ergenekon timeline 01HXYZ... ${c.reset}
  ${c.dim}ergenekon export 01HXYZ... recording.ergenekon.bin${c.reset}
  ${c.dim}ergenekon watch${c.reset}
`);
}

// ── Main ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'sessions':
      case 'ls':
        await cmdSessions();
        break;
      case 'inspect':
      case 'show':
        if (!args[1]) { console.error('Usage: ergenekon inspect <sessionId>'); process.exit(1); }
        await cmdInspect(args[1]);
        break;
      case 'timeline':
      case 'tl':
        if (!args[1]) { console.error('Usage: ergenekon timeline <sessionId>'); process.exit(1); }
        await cmdTimeline(args[1]);
        break;
      case 'trace':
        if (!args[1]) { console.error('Usage: ergenekon trace <traceId>'); process.exit(1); }
        await cmdTrace(args[1]);
        break;
      case 'export':
        if (!args[1]) { console.error('Usage: ergenekon export <sessionId> [outputFile]'); process.exit(1); }
        await cmdExport(args[1], args[2]);
        break;
      case 'import':
        if (!args[1]) { console.error('Usage: ergenekon import <file>'); process.exit(1); }
        await cmdImport(args[1]);
        break;
      case 'stats':
        await cmdStats();
        break;
      case 'watch':
      case 'tail':
        await cmdWatch();
        break;
      case 'health':
      case 'ping':
        await cmdHealth();
        break;
      case 'doctor':
      case 'diag':
      case 'diagnose':
        await cmdDoctor();
        break;
      case 'help':
      case '--help':
      case '-h':
      case undefined:
        showHelp();
        break;
      default:
        console.error(`${c.red}Unknown command: ${command}${c.reset}\n`);
        showHelp();
        process.exit(1);
    }
  } catch (err) {
    if (err instanceof Error && err.message.includes('ECONNREFUSED')) {
      console.error(`\n${c.red}✗ Cannot connect to collector at ${COLLECTOR_URL}${c.reset}`);
      console.error(`  ${c.dim}Is the collector running? Start it with: npx tsx demo/fullstack-demo.ts${c.reset}\n`);
    } else {
      console.error(`\n${c.red}Error: ${err}${c.reset}\n`);
    }
    process.exit(1);
  }
}

main();
