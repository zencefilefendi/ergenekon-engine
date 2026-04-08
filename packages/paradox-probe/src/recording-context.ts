// ============================================================================
// PARADOX PROBE — Recording Context
//
// Uses AsyncLocalStorage to propagate recording state through the entire
// async call chain of a request. This is the invisible thread that connects
// every intercepted I/O call back to its parent request.
//
// Think of it as "thread-local storage" but for Node.js async operations.
// ============================================================================

import { AsyncLocalStorage } from 'node:async_hooks';
import type { ParadoxEvent, HLCTimestamp } from '@paradox/core';
import { HybridLogicalClock, ulid } from '@paradox/core';
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

  private events: ParadoxEvent[] = [];
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
   */
  record(
    type: ParadoxEvent['type'],
    operationName: string,
    data: Record<string, unknown>,
    opts?: { durationMs?: number; error?: ParadoxEvent['error']; tags?: Record<string, string> }
  ): ParadoxEvent {
    const now = this.hlc.now();
    const event: ParadoxEvent = {
      id: ulid(),
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      hlc: now,
      wallClock: originalDateNow(),
      type,
      serviceName: this.serviceName,
      operationName,
      sequence: this.sequence++,
      data,
      durationMs: opts?.durationMs ?? 0,
      error: opts?.error ?? null,
      tags: opts?.tags ?? {},
    };

    this.events.push(event);
    return event;
  }

  /** Get all recorded events (immutable copy) */
  getEvents(): readonly ParadoxEvent[] {
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
  finalize(): import('@paradox/core').RecordingSession {
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
