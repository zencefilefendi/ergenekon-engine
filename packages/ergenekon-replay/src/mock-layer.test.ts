// ============================================================================
// ERGENEKON REPLAY — Mock Layer Tests
//
// Validates Issue 5 fix — the EXISTENTIAL invariant:
//   1. mockDateNow() NEVER falls back to real Date.now()
//   2. mockMathRandom() NEVER falls back to real Math.random()
//   3. mockRandomUUID() NEVER falls back to real crypto.randomUUID()
//   4. Missing events ALWAYS throw ReplayDivergenceError
//   5. Correct events replay deterministically
// ============================================================================

import { describe, it, expect } from 'vitest';
import { MockLayer, ReplayDivergenceError } from './mock-layer.js';
import type { RecordingSession, EventType, ErgenekonEvent } from '@ergenekon/core';

// ─── Test Helpers ───

function makeEvent(overrides: Partial<ErgenekonEvent> & { type: EventType }): ErgenekonEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2)}`,
    sessionId: 'test-session',
    type: overrides.type,
    timestamp: { wallTime: Date.now(), logical: 0, nodeId: 'test' },
    sequence: 0,
    operationName: overrides.operationName ?? overrides.type,
    data: overrides.data ?? {},
    ...overrides,
  };
}

function makeSession(events: ErgenekonEvent[]): RecordingSession {
  return {
    id: 'test-session',
    traceId: 'trace-1',
    parentSpanId: undefined,
    metadata: {
      serviceName: 'test',
      startedAt: Date.now(),
      endedAt: Date.now() + 100,
      probeVersion: '0.4.0',
      nodeVersion: 'v22.0.0',
    },
    events: events.map((e, i) => ({ ...e, sequence: i })),
  };
}

// ─── Tests ───

describe('MockLayer — Determinism Invariant', () => {
  describe('mockDateNow()', () => {
    it('returns recorded timestamp values in order', () => {
      const session = makeSession([
        makeEvent({ type: 'timestamp', data: { operation: 'Date.now', value: 1000 } }),
        makeEvent({ type: 'timestamp', data: { operation: 'Date.now', value: 2000 } }),
        makeEvent({ type: 'timestamp', data: { operation: 'Date.now', value: 3000 } }),
      ]);

      const mock = new MockLayer(session);
      expect(mock.mockDateNow()).toBe(1000);
      expect(mock.mockDateNow()).toBe(2000);
      expect(mock.mockDateNow()).toBe(3000);
    });

    it('throws ReplayDivergenceError when no more timestamp events (NEVER falls back)', () => {
      const session = makeSession([
        makeEvent({ type: 'timestamp', data: { operation: 'Date.now', value: 1000 } }),
      ]);

      const mock = new MockLayer(session);
      mock.mockDateNow(); // consume the only one

      expect(() => mock.mockDateNow()).toThrow(ReplayDivergenceError);
    });

    it('error message includes diagnostic context', () => {
      const session = makeSession([
        makeEvent({ type: 'timestamp', data: { operation: 'Date.now', value: 1000 } }),
      ]);

      const mock = new MockLayer(session);
      mock.mockDateNow();

      try {
        mock.mockDateNow();
        expect.fail('should have thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ReplayDivergenceError);
        const divergence = err as ReplayDivergenceError;
        expect(divergence.expectedType).toBe('timestamp');
        expect(divergence.actualType).toBe('MISSING');
        expect(divergence.message).toContain('1 were recorded');
        expect(divergence.message).toContain('non-deterministic');
      }
    });
  });

  describe('mockMathRandom()', () => {
    it('returns recorded random values in order', () => {
      const session = makeSession([
        makeEvent({ type: 'random', data: { operation: 'Math.random', value: 0.123 } }),
        makeEvent({ type: 'random', data: { operation: 'Math.random', value: 0.456 } }),
      ]);

      const mock = new MockLayer(session);
      expect(mock.mockMathRandom()).toBe(0.123);
      expect(mock.mockMathRandom()).toBe(0.456);
    });

    it('throws ReplayDivergenceError when exhausted (NEVER falls back)', () => {
      const session = makeSession([]);
      const mock = new MockLayer(session);

      expect(() => mock.mockMathRandom()).toThrow(ReplayDivergenceError);
    });
  });

  describe('mockRandomUUID()', () => {
    it('returns recorded UUID', () => {
      const session = makeSession([
        makeEvent({ type: 'uuid' as EventType, data: { operation: 'crypto.randomUUID', value: 'aaaa-bbbb-cccc' } }),
      ]);

      const mock = new MockLayer(session);
      expect(mock.mockRandomUUID()).toBe('aaaa-bbbb-cccc');
    });

    it('throws ReplayDivergenceError when exhausted (NEVER falls back)', () => {
      const session = makeSession([]);
      const mock = new MockLayer(session);

      expect(() => mock.mockRandomUUID()).toThrow(ReplayDivergenceError);
    });
  });

  describe('mockFetch()', () => {
    it('returns recorded HTTP response', () => {
      const session = makeSession([
        makeEvent({
          type: 'http_response_in',
          data: {
            url: 'http://api.example.com/users/1',
            status: 200,
            statusText: 'OK',
            headers: { 'content-type': 'application/json' },
            body: { id: 1, name: 'Test' },
          },
        }),
      ]);

      const mock = new MockLayer(session);
      const result = mock.mockFetch('http://api.example.com/users/1');
      expect(result).not.toBeNull();
      expect(result!.status).toBe(200);
      expect(result!.body).toEqual({ id: 1, name: 'Test' });
    });

    it('returns null when no more http_response_in events', () => {
      const session = makeSession([]);
      const mock = new MockLayer(session);
      expect(mock.mockFetch('http://example.com')).toBeNull();
    });
  });

  describe('interleaved event types', () => {
    it('handles mixed event types consumed by different mock functions', () => {
      const session = makeSession([
        makeEvent({ type: 'timestamp', data: { value: 1000 } }),
        makeEvent({ type: 'random', data: { value: 0.5 } }),
        makeEvent({ type: 'timestamp', data: { value: 2000 } }),
        makeEvent({ type: 'random', data: { value: 0.7 } }),
        makeEvent({ type: 'uuid' as EventType, data: { value: 'uuid-1' } }),
      ]);

      const mock = new MockLayer(session);
      expect(mock.mockDateNow()).toBe(1000);
      expect(mock.mockMathRandom()).toBe(0.5);
      expect(mock.mockDateNow()).toBe(2000);
      expect(mock.mockMathRandom()).toBe(0.7);
      expect(mock.mockRandomUUID()).toBe('uuid-1');

      // All consumed — next call to any mock should throw or return null
      expect(() => mock.mockDateNow()).toThrow(ReplayDivergenceError);
      expect(() => mock.mockMathRandom()).toThrow(ReplayDivergenceError);
      expect(() => mock.mockRandomUUID()).toThrow(ReplayDivergenceError);
    });
  });

  describe('expect()', () => {
    it('returns event of expected type', () => {
      const session = makeSession([
        makeEvent({ type: 'timestamp', data: { value: 42 } }),
      ]);
      const mock = new MockLayer(session);
      const event = mock.expect('timestamp');
      expect(event.data['value']).toBe(42);
    });

    it('throws ReplayDivergenceError for unexpected EOF', () => {
      const session = makeSession([]);
      const mock = new MockLayer(session);
      expect(() => mock.expect('timestamp')).toThrow(ReplayDivergenceError);
    });
  });

  describe('state inspection', () => {
    it('tracks remaining events correctly', () => {
      const session = makeSession([
        makeEvent({ type: 'timestamp', data: { value: 1 } }),
        makeEvent({ type: 'timestamp', data: { value: 2 } }),
        makeEvent({ type: 'timestamp', data: { value: 3 } }),
      ]);

      const mock = new MockLayer(session);
      expect(mock.remaining).toBe(3);
      expect(mock.isComplete).toBe(false);

      mock.next();
      expect(mock.remaining).toBe(2);

      mock.next();
      mock.next();
      expect(mock.remaining).toBe(0);
      expect(mock.isComplete).toBe(true);
    });

    it('reset() brings cursor back to start', () => {
      const session = makeSession([
        makeEvent({ type: 'timestamp', data: { value: 1000 } }),
        makeEvent({ type: 'timestamp', data: { value: 2000 } }),
      ]);

      const mock = new MockLayer(session);
      expect(mock.mockDateNow()).toBe(1000);
      expect(mock.mockDateNow()).toBe(2000);

      mock.reset();
      expect(mock.mockDateNow()).toBe(1000);
    });
  });
});
