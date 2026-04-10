// ============================================================================
// PARADOX COLLECTOR — Storage Tests
//
// Validates Issue 2 fix invariants:
//   1. durableWrite guarantees crash-safe files
//   2. Checksum verification catches corruption
//   3. Corrupt files are quarantined, not silently skipped
//   4. Backwards-compatible with legacy (pre-checksum) files
//   5. Store + load round-trip preserves data exactly
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStorage } from './storage.js';
import { wrapWithChecksum, verifyAndUnwrap, ChecksumError, computeChecksum } from './checksum.js';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { RecordingSession, EventType } from '@paradox/core';

function makeSession(id: string): RecordingSession {
  return {
    id,
    traceId: 'trace-' + id,
    parentSpanId: undefined,
    metadata: {
      serviceName: 'test-service',
      startedAt: 1700000000000,
      endedAt: 1700000000100,
      probeVersion: '0.4.0',
      nodeVersion: 'v22.0.0',
    },
    events: [{
      id: 'evt-1',
      sessionId: id,
      type: 'timestamp' as EventType,
      timestamp: { wallTime: 1700000000000, logical: 0, nodeId: 'test' },
      sequence: 0,
      data: { operation: 'Date.now', value: 1700000000000 },
    }],
  };
}

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), 'paradox-storage-'));
}

// ─── Checksum unit tests ───

describe('checksum utilities', () => {
  it('computeChecksum returns sha256:<hex>', () => {
    const cksum = computeChecksum({ hello: 'world' });
    expect(cksum).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it('computeChecksum is deterministic', () => {
    const data = { a: 1, b: [2, 3] };
    expect(computeChecksum(data)).toBe(computeChecksum(data));
  });

  it('wrapWithChecksum + verifyAndUnwrap round-trips', () => {
    const original = { x: 42, name: 'PARADOX' };
    const wrapped = wrapWithChecksum(original);
    const unwrapped = verifyAndUnwrap<typeof original>(wrapped);
    expect(unwrapped).toEqual(original);
  });

  it('verifyAndUnwrap throws ChecksumError on tampered data', () => {
    const wrapped = wrapWithChecksum({ value: 'original' });
    // Tamper: change a character in the data
    const tampered = wrapped.replace('"original"', '"tampered"');
    expect(() => verifyAndUnwrap(tampered)).toThrow(ChecksumError);
  });

  it('verifyAndUnwrap handles legacy files (no checksum)', () => {
    const legacy = JSON.stringify({ id: 'old-session', events: [] });
    const result = verifyAndUnwrap<{ id: string }>(legacy);
    expect(result.id).toBe('old-session');
  });

  it('verifyAndUnwrap throws on malformed JSON', () => {
    expect(() => verifyAndUnwrap('not-json{')).toThrow(ChecksumError);
  });
});

// ─── FileStorage integration tests ───

describe('FileStorage', () => {
  let tmpDir: string;
  let storage: FileStorage;

  beforeEach(async () => {
    tmpDir = makeTmpDir();
    storage = new FileStorage(tmpDir);
    await storage.init();
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('store + load round-trip preserves session data exactly', async () => {
    const session = makeSession('rt-001');
    await storage.store(session);
    const loaded = await storage.load('rt-001');

    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(session.id);
    expect(loaded!.traceId).toBe(session.traceId);
    expect(loaded!.events).toHaveLength(1);
    expect(loaded!.events[0]!.data).toEqual(session.events[0]!.data);
  });

  it('stored files have checksum wrapper', async () => {
    const session = makeSession('cksum-001');
    await storage.store(session);

    const { readFileSync } = await import('node:fs');
    const raw = readFileSync(join(tmpDir, 'sessions', 'cksum-001.json'), 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed._cksum).toMatch(/^sha256:/);
    expect(parsed._v).toBe(1);
    expect(parsed.data.id).toBe('cksum-001');
  });

  it('detects and quarantines corrupt files', async () => {
    const session = makeSession('corrupt-001');
    await storage.store(session);

    // Tamper with the file directly
    const filepath = join(tmpDir, 'sessions', 'corrupt-001.json');
    writeFileSync(filepath, '{"_cksum":"sha256:bad","_v":1,"data":{"id":"corrupt-001"}}');

    // Re-init to trigger rebuildIndex which verifies checksums
    const storage2 = new FileStorage(tmpDir);
    await storage2.init();

    expect(storage2.getCorruptCount()).toBe(1);
    expect(await storage2.load('corrupt-001')).toBeNull();

    // File should be in corrupt/ directory
    const corruptFiles = readdirSync(join(tmpDir, 'sessions', 'corrupt'));
    expect(corruptFiles.length).toBe(1);
    expect(corruptFiles[0]).toContain('corrupt-001.json');
  });

  it('load returns null for non-existent session', async () => {
    expect(await storage.load('does-not-exist')).toBeNull();
  });

  it('findByTraceId returns all sessions with matching trace', async () => {
    const s1 = makeSession('t1-a');
    s1.traceId = 'shared-trace';
    const s2 = makeSession('t1-b');
    s2.traceId = 'shared-trace';
    const s3 = makeSession('t2-a');
    s3.traceId = 'other-trace';

    await storage.store(s1);
    await storage.store(s2);
    await storage.store(s3);

    const found = await storage.findByTraceId('shared-trace');
    expect(found).toHaveLength(2);
    expect(found.map(s => s.id).sort()).toEqual(['t1-a', 't1-b']);
  });

  it('listSessions returns summary for all sessions', async () => {
    await storage.store(makeSession('list-1'));
    await storage.store(makeSession('list-2'));
    await storage.store(makeSession('list-3'));

    const list = await storage.listSessions();
    expect(list).toHaveLength(3);
    expect(list[0]).toHaveProperty('id');
    expect(list[0]).toHaveProperty('eventCount');
    expect(list[0]).toHaveProperty('hasError');
    expect(list[0]).not.toHaveProperty('events'); // no full events
  });

  it('persists across restart (rebuild from disk)', async () => {
    await storage.store(makeSession('persist-1'));
    await storage.store(makeSession('persist-2'));

    // Create a new storage instance pointing to same dir
    const storage2 = new FileStorage(tmpDir);
    await storage2.init();

    const loaded = await storage2.load('persist-1');
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe('persist-1');

    const list = await storage2.listSessions();
    expect(list).toHaveLength(2);
  });

  it('getCorruptCount starts at 0', () => {
    expect(storage.getCorruptCount()).toBe(0);
  });
});
