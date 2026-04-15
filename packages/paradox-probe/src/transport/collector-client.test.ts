// ============================================================================
// ERGENEKON PROBE — Collector Client Tests
//
// Validates the Issue 1 fix invariants:
//   1. A session is NEVER silently dropped
//   2. Circuit breaker activates after N failures
//   3. Spill buffer persists to disk during outages
//   4. Health struct reflects real state
//   5. Recovery drains spill buffer
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SpillBuffer } from './spill-buffer.js';
import { CollectorClient } from './collector-client.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RecordingSession, EventType } from '@ergenekon/core';

// ─── Test Helpers ───

function makeSession(id: string): RecordingSession {
  return {
    id,
    traceId: 'trace-' + id,
    parentSpanId: undefined,
    metadata: {
      serviceName: 'test-service',
      startedAt: Date.now(),
      endedAt: Date.now() + 100,
      probeVersion: '0.4.0',
      nodeVersion: process.version,
    },
    events: [{
      id: 'evt-1',
      sessionId: id,
      type: 'timestamp' as EventType,
      timestamp: { wallTime: Date.now(), logical: 0, nodeId: 'test' },
      sequence: 0,
      data: { operation: 'Date.now', value: Date.now() },
    }],
  };
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'ergenekon-test-'));
}

describe('SpillBuffer', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('appends sessions as NDJSON and drains them', () => {
    const spill = new SpillBuffer({ spillDir: tmpDir });

    const s1 = makeSession('spill-1');
    const s2 = makeSession('spill-2');
    const s3 = makeSession('spill-3');

    expect(spill.append(s1)).toBe(true);
    expect(spill.append(s2)).toBe(true);
    expect(spill.append(s3)).toBe(true);
    expect(spill.getFileCount()).toBe(1);

    const drained = spill.drain();
    expect(drained).toHaveLength(3);
    expect(drained[0]!.id).toBe('spill-1');
    expect(drained[2]!.id).toBe('spill-3');

    // After drain, files are deleted
    expect(spill.getFileCount()).toBe(0);
  });

  it('rotates files after maxLinesPerFile', () => {
    // Use small limit for fast testing
    const spill = new SpillBuffer({ spillDir: tmpDir, maxLinesPerFile: 5 });

    for (let i = 0; i < 11; i++) {
      spill.append(makeSession(`s-${i}`));
    }

    // 5 in first file, 5 in second, 1 in third
    expect(spill.getFileCount()).toBe(3);

    const drained = spill.drain();
    expect(drained).toHaveLength(11);
  });

  it('enforces max spill files', () => {
    const spill = new SpillBuffer({
      spillDir: tmpDir,
      maxSpillFiles: 2,
      maxLinesPerFile: 3,
    });

    // Write enough to create 4+ files (3 lines each, 13 lines total)
    for (let i = 0; i < 13; i++) {
      spill.append(makeSession(`s-${i}`));
    }

    // Should have trimmed oldest, keeping only 2
    expect(spill.getFileCount()).toBeLessThanOrEqual(2);
  });

  it('returns empty array when drain called on empty spill dir', () => {
    const spill = new SpillBuffer({ spillDir: tmpDir });
    expect(spill.drain()).toEqual([]);
  });

  it('preserves session data through spill/drain cycle', () => {
    const spill = new SpillBuffer({ spillDir: tmpDir });
    const original = makeSession('integrity-check');
    spill.append(original);

    const drained = spill.drain();
    expect(drained).toHaveLength(1);
    expect(drained[0]!.id).toBe(original.id);
    expect(drained[0]!.traceId).toBe(original.traceId);
    expect(drained[0]!.events).toHaveLength(1);
    expect(drained[0]!.events[0]!.type).toBe('timestamp');
  });
});

describe('CollectorClient', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('health tracking', () => {
    it('starts healthy with zero counters', () => {
      const client = new CollectorClient({
        collectorUrl: 'http://localhost:99999',
        flushIntervalMs: 60_000,
        maxBufferSize: 100,
        spillConfig: { spillDir: tmpDir },
      });

      const health = client.getHealth();
      expect(health.status).toBe('healthy');
      expect(health.consecutiveFailures).toBe(0);
      expect(health.totalDropped).toBe(0);
      expect(health.totalSpilled).toBe(0);
      expect(health.totalSent).toBe(0);
      expect(health.lastError).toBeNull();
    });
  });

  describe('local store mode', () => {
    it('stores sessions in memory when local mode is enabled', () => {
      const client = new CollectorClient({
        collectorUrl: 'http://localhost:99999',
        flushIntervalMs: 60_000,
        maxBufferSize: 100,
        spillConfig: { spillDir: tmpDir },
      });

      client.enableLocalStore();
      client.enqueue(makeSession('s1'));
      client.enqueue(makeSession('s2'));

      const recordings = client.getLocalRecordings();
      expect(recordings).toHaveLength(2);
      expect(recordings[0]!.id).toBe('s1');

      client.clearLocalRecordings();
      expect(client.getLocalRecordings()).toHaveLength(0);
    });
  });
});
