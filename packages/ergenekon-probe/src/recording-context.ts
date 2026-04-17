// ============================================================================
// ERGENEKON PROBE — Recording Context
//
// Uses AsyncLocalStorage to propagate recording state through the entire
// async call chain of a request. This is the invisible thread that connects
// every intercepted I/O call back to its parent request.
//
// Think of it as "thread-local storage" but for Node.js async operations.
// ============================================================================

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ErgenekonEvent, HLCTimestamp } from '@ergenekon/core';
import { HybridLogicalClock, ulid } from '@ergenekon/core';
import { originalDateNow } from './internal-clock.js';

/**
 * Mutable recording state for a single request lifecycle.
 * Created when a request arrives, finalized when the response is sent.
 */
export class RecordingSession {
  readonly id: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId: string | null;
  readonly serviceName: string;
  readonly startedAt: number;

  private events: ErgenekonEvent[] = [];
  private sequence = 0;
  private readonly hlc: HybridLogicalClock;

  constructor(opts: {
    traceId: string;
    spanId: string;
    parentSpanId: string | null;
    serviceName: string;
    hlc: HybridLogicalClock;
  }) {
    this.id = ulid();
    this.traceId = opts.traceId;
    this.spanId = opts.spanId;
    this.parentSpanId = opts.parentSpanId;
    this.serviceName = opts.serviceName;
    this.startedAt = originalDateNow();
    this.hlc = opts.hlc;
  }

  /**
   * Record an event into this session.
   * Events are automatically assigned a sequence number and HLC timestamp.
   *
   * Safety limits:
   *   - Max 10,000 events per session (prevents unbounded memory growth)
   *   - Data keys truncated to 1KB string values (prevents huge response bodies from OOMing)
   */
  private static readonly MAX_EVENTS = 10_000;
  private static readonly MAX_VALUE_LENGTH = 1024;
  private _overflowed = false;

  record(
    type: ErgenekonEvent['type'],
    operationName: string,
    data: Record<string, unknown>,
    opts?: { durationMs?: number; error?: ErgenekonEvent['error']; tags?: Record<string, string> }
  ): ErgenekonEvent | null {
    // Guard: prevent unbounded event growth from crashing host app
    if (this.events.length >= RecordingSession.MAX_EVENTS) {
      if (!this._overflowed) {
        this._overflowed = true;
        // Record ONE overflow marker event, skip all further events
        const marker: ErgenekonEvent = {
          id: ulid(),
          traceId: this.traceId,
          spanId: this.spanId,
          parentSpanId: this.parentSpanId,
          hlc: this.hlc.now(),
          wallClock: originalDateNow(),
          type: 'custom',
          serviceName: this.serviceName,
          operationName: '[ERGENEKON] Event limit reached (10,000)',
          sequence: this.sequence++,
          data: { warning: 'Session truncated — event limit reached' },
          durationMs: 0,
          error: null,
          tags: {},
        };
        this.events.push(marker);
      }
      return null;
    }

    // Truncate large string values in data to prevent OOM
    const safeData = this.truncateData(data);

    const now = this.hlc.now();
    const event: ErgenekonEvent = {
      id: ulid(),
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      hlc: now,
      wallClock: originalDateNow(),
      type,
      serviceName: this.serviceName,
      operationName: operationName.length > 256 ? operationName.slice(0, 256) + '…' : operationName,
      sequence: this.sequence++,
      data: safeData,
      durationMs: opts?.durationMs ?? 0,
      error: opts?.error ?? null,
      tags: opts?.tags ?? {},
    };

    this.events.push(event);
    return event;
  }

  /** Truncate large string values to prevent memory exhaustion */
  private truncateData(data: Record<string, unknown>, depth = 0): Record<string, unknown> {
    if (depth > 5) return { _truncated: 'max depth exceeded' };
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'string' && value.length > RecordingSession.MAX_VALUE_LENGTH) {
        result[key] = value.slice(0, RecordingSession.MAX_VALUE_LENGTH) + `… [truncated ${value.length} chars]`;
      } else if (value && typeof value === 'object' && !Array.isArray(value)) {
        result[key] = this.truncateData(value as Record<string, unknown>, depth + 1);
      } else if (Array.isArray(value) && value.length > 100) {
        result[key] = value.slice(0, 100);
      } else {
        result[key] = value;
      }
    }
    return result;
  }

  /** Get all recorded events (immutable copy) */
  getEvents(): readonly ErgenekonEvent[] {
    return [...this.events];
  }

  /** Get the current event count */
  get eventCount(): number {
    return this.events.length;
  }

  /** Receive an HLC timestamp from a remote service */
  receiveRemoteTimestamp(remote: HLCTimestamp): void {
    this.hlc.receive(remote);
  }

  /** Export as a serializable recording */
  finalize(): import('@ergenekon/core').RecordingSession {
    return {
      id: this.id,
      traceId: this.traceId,
      serviceName: this.serviceName,
      startedAt: this.startedAt,
      endedAt: originalDateNow(),
      events: [...this.events],
      metadata: {
        nodeVersion: process.version,
        platform: process.platform,
        probeVersion: '0.1.0',
        hasError: this.events.some(e => e.error !== null),
        totalDurationMs: originalDateNow() - this.startedAt,
      },
    };
  }
}

// ── AsyncLocalStorage instance (singleton) ──────────────────────────

const storage = new AsyncLocalStorage<RecordingSession>();

/** Get the active recording session for the current async context */
export function getActiveSession(): RecordingSession | undefined {
  return storage.getStore();
}

/** Run a function within a recording session context */
export function runWithSession<T>(session: RecordingSession, fn: () => T): T {
  return storage.run(session, fn);
}
