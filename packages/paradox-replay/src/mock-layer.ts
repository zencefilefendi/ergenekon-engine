// ============================================================================
// PARADOX REPLAY — Mock I/O Layer
//
// The heart of deterministic replay. This module replaces all I/O
// operations with recorded values, making the application behave
// EXACTLY as it did during the original execution.
//
// Analogy: If the probe is a "video camera" recording I/O,
// the mock layer is a "projector" playing it back.
//
// Critical invariant: Events must be consumed in EXACTLY the same
// order they were recorded. Any divergence means the code has changed
// and the replay is no longer valid.
// ============================================================================

import type { ParadoxEvent, EventType, RecordingSession } from '@paradox/core';

export class ReplayDivergenceError extends Error {
  constructor(
    public readonly expectedType: EventType | 'any',
    public readonly actualType: string,
    public readonly sequence: number,
    message?: string
  ) {
    super(
      message ??
      `Replay divergence at sequence ${sequence}: ` +
      `expected "${expectedType}" but got "${actualType}". ` +
      `The application code may have changed since the recording.`
    );
    this.name = 'ReplayDivergenceError';
  }
}

/**
 * The Mock I/O Layer — feeds recorded values back to the application
 * during replay, replacing all real I/O operations.
 */
export class MockLayer {
  private readonly events: ParadoxEvent[];
  private cursor = 0;
  private readonly eventsByType = new Map<EventType, ParadoxEvent[]>();

  // Track replay state
  private replayLog: Array<{ sequence: number; type: EventType; operation: string }> = [];

  constructor(session: RecordingSession) {
    // Skip the first (http_request_in) and last (http_response_out) events
    // — those are the request/response boundary handled by the replay harness
    this.events = session.events;

    // Build type-indexed queues for typed consumption
    for (const event of session.events) {
      const queue = this.eventsByType.get(event.type) ?? [];
      queue.push(event);
      this.eventsByType.set(event.type, queue);
    }
  }

  /**
   * Get the next event of ANY type (sequential consumption).
   */
  next(): ParadoxEvent | null {
    if (this.cursor >= this.events.length) return null;
    const event = this.events[this.cursor++];
    this.replayLog.push({
      sequence: event.sequence,
      type: event.type,
      operation: event.operationName,
    });
    return event;
  }

  /**
   * Get the next event of a SPECIFIC type.
   * Used by typed interceptors (e.g., "give me the next timestamp event").
   */
  nextOfType(type: EventType): ParadoxEvent | null {
    const queue = this.eventsByType.get(type);
    if (!queue || queue.length === 0) return null;
    const event = queue.shift()!;
    this.replayLog.push({
      sequence: event.sequence,
      type: event.type,
      operation: event.operationName,
    });
    return event;
  }

  /**
   * Peek at the next event without consuming it.
   */
  peek(): ParadoxEvent | null {
    if (this.cursor >= this.events.length) return null;
    return this.events[this.cursor];
  }

  /**
   * Get the next event, asserting its type.
   * Throws ReplayDivergenceError if the type doesn't match.
   */
  expect(type: EventType): ParadoxEvent {
    const event = this.nextOfType(type);
    if (!event) {
      throw new ReplayDivergenceError(
        type,
        'EOF',
        this.cursor,
        `Expected "${type}" event but no more events of this type remain`
      );
    }
    return event;
  }

  // ── Typed mock functions ────────────────────────────────────────

  /** Mock Date.now() — returns the recorded timestamp */
  mockDateNow(): number {
    const event = this.nextOfType('timestamp');
    if (!event) {
      // Fallback: if no more timestamp events, return wall clock from last event
      return Date.now();
    }
    return event.data['value'] as number;
  }

  /** Mock Math.random() — returns the recorded random value */
  mockMathRandom(): number {
    const event = this.nextOfType('random');
    if (!event) {
      // Fallback: should not happen in a correct replay
      return Math.random();
    }
    return event.data['value'] as number;
  }

  /** Mock fetch() — returns the recorded response */
  mockFetch(url: string): {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
  } | null {
    const event = this.nextOfType('http_response_in');
    if (!event) return null;

    return {
      status: event.data['status'] as number,
      statusText: (event.data['statusText'] as string) ?? 'OK',
      headers: (event.data['headers'] as Record<string, string>) ?? {},
      body: event.data['body'],
    };
  }

  /** Mock db.query() — returns the recorded PostgreSQL result */
  mockDbQuery(): { rows: unknown[]; rowCount: number } | null {
    // Consume the db_query event first (the query itself)
    this.nextOfType('db_query');
    const event = this.nextOfType('db_result');
    if (!event) return null;

    return {
      rows: event.data['rows'] as unknown[],
      rowCount: event.data['rowCount'] as number,
    };
  }

  /** Mock Redis command — returns the recorded result */
  mockRedisCommand(): unknown {
    // Consume the cache_get event (the command)
    this.nextOfType('cache_get');
    const event = this.nextOfType('cache_set');
    if (!event) return null;
    return event.data['result'];
  }

  /** Mock crypto.randomUUID() — returns the recorded UUID */
  mockRandomUUID(): string {
    const event = this.nextOfType('uuid');
    if (!event) return crypto.randomUUID();
    return event.data['value'] as string;
  }

  /** Mock setTimeout — returns timing data */
  mockTimer(): { timerId: string; delay: number } | null {
    const event = this.nextOfType('timer_set');
    if (!event) return null;
    return {
      timerId: event.data['timerId'] as string,
      delay: event.data['delay'] as number,
    };
  }

  /** Get console output events for replay inspection */
  getConsoleEvents(): Array<{ level: string; args: string[]; timestamp: number }> {
    return this.events
      .filter(e => e.type === 'custom' && ['console.log', 'console.warn', 'console.error'].includes(e.operationName))
      .map(e => ({
        level: e.data['level'] as string,
        args: e.data['args'] as string[],
        timestamp: e.data['timestamp'] as number,
      }));
  }

  /** Get error events for replay inspection */
  getErrorEvents(): Array<{ type: string; name: string; message: string; stack: string | null }> {
    return this.events
      .filter(e => e.type === 'error')
      .map(e => ({
        type: e.data['type'] as string,
        name: e.data['name'] as string,
        message: e.data['message'] as string,
        stack: e.data['stack'] as string | null,
      }));
  }

  // ── State inspection ────────────────────────────────────────────

  /** Check if all events have been consumed */
  get isComplete(): boolean {
    return this.cursor >= this.events.length;
  }

  /** Get number of remaining events */
  get remaining(): number {
    return this.events.length - this.cursor;
  }

  /** Get the replay log (what was consumed and in what order) */
  getReplayLog(): ReadonlyArray<{ sequence: number; type: EventType; operation: string }> {
    return [...this.replayLog];
  }

  /** Get the incoming request event */
  getRequestEvent(): ParadoxEvent | null {
    return this.events.find(e => e.type === 'http_request_in') ?? null;
  }

  /** Get the outgoing response event */
  getResponseEvent(): ParadoxEvent | null {
    return [...this.events].reverse().find(e => e.type === 'http_response_out') ?? null;
  }

  /** Seek to a specific sequence number (for time-travel) */
  seekTo(sequence: number): void {
    this.cursor = Math.max(0, Math.min(sequence, this.events.length));
    // Rebuild type queues from cursor position
    this.eventsByType.clear();
    for (let i = this.cursor; i < this.events.length; i++) {
      const event = this.events[i];
      const queue = this.eventsByType.get(event.type) ?? [];
      queue.push(event);
      this.eventsByType.set(event.type, queue);
    }
  }

  /** Reset to the beginning */
  reset(): void {
    this.seekTo(0);
    this.replayLog = [];
  }
}
