// ============================================================================
// ERGENEKON REPLAY — Replay Engine
//
// Orchestrates the deterministic replay of a recorded session.
//
// How it works:
// 1. Load the recording (events captured by the probe)
// 2. Install mock layer (replace all I/O with recorded values)
// 3. Reconstruct the original request
// 4. Send it through the application
// 5. Compare the replayed response with the recorded response
//
// The application code runs UNMODIFIED — only the I/O boundaries
// are replaced with mocks. If the code is deterministic (which it
// is when all I/O is mocked), the result MUST be identical.
// ============================================================================

import { readFile } from 'node:fs/promises';
import type { RecordingSession, ErgenekonEvent } from '@ergenekon/core';
import { MockLayer, ReplayDivergenceError } from './mock-layer.js';

export interface ReplayResult {
  /** Whether the replay produced the same output as the original */
  success: boolean;

  /** The replayed response (if the replay completed) */
  replayedResponse: {
    statusCode: number;
    headers: Record<string, unknown>;
    body: unknown;
  } | null;

  /** The original response (from the recording) */
  originalResponse: {
    statusCode: number;
    headers: Record<string, unknown>;
    body: unknown;
  } | null;

  /** Differences between original and replayed response */
  differences: string[];

  /** Events consumed during replay */
  eventsConsumed: number;

  /** Events remaining (unconsumed — potential divergence indicator) */
  eventsRemaining: number;

  /** Replay duration in ms */
  replayDurationMs: number;

  /** Error if replay failed */
  error: string | null;
}

export interface TimelineSnapshot {
  /** Event sequence number */
  sequence: number;
  /** Event type */
  type: string;
  /** Human-readable operation name */
  operation: string;
  /** Wall clock time */
  wallClock: number;
  /** Event data */
  data: Record<string, unknown>;
  /** Duration of this operation */
  durationMs: number;
}

/**
 * The ERGENEKON Replay Engine.
 *
 * Can operate in two modes:
 * 1. Full replay: Sends the recorded request through the app and compares
 * 2. Inspection: Browse the recording timeline without running code
 */
export class ReplayEngine {
  private session: RecordingSession | null = null;
  private mockLayer: MockLayer | null = null;

  /** Load a recording from a file */
  async loadFromFile(path: string): Promise<RecordingSession> {
    const data = await readFile(path, 'utf-8');
    this.session = JSON.parse(data) as RecordingSession;
    this.mockLayer = new MockLayer(this.session);
    return this.session;
  }

  /** Load a recording from a session object */
  loadFromSession(session: RecordingSession): void {
    this.session = session;
    this.mockLayer = new MockLayer(session);
  }

  /** Get the mock layer (for installing into the application) */
  getMockLayer(): MockLayer {
    if (!this.mockLayer) throw new Error('No recording loaded');
    return this.mockLayer;
  }

  /** Get the loaded session */
  getSession(): RecordingSession {
    if (!this.session) throw new Error('No recording loaded');
    return this.session;
  }

  // ── Timeline Inspection (Time-Travel) ───────────────────────────

  /**
   * Get the full event timeline for visualization.
   * This is what the Time-Travel UI will display.
   */
  getTimeline(): TimelineSnapshot[] {
    if (!this.session) throw new Error('No recording loaded');

    return this.session.events.map((event) => ({
      sequence: event.sequence,
      type: event.type,
      operation: event.operationName,
      wallClock: event.wallClock,
      data: event.data,
      durationMs: event.durationMs,
    }));
  }

  /**
   * Get the state at a specific point in time (sequence number).
   * Returns all events up to that point.
   */
  getStateAt(sequence: number): {
    events: ErgenekonEvent[];
    currentEvent: ErgenekonEvent | null;
    progress: number; // 0.0 to 1.0
  } {
    if (!this.session) throw new Error('No recording loaded');

    const events = this.session.events.filter((e) => e.sequence <= sequence);
    const currentEvent = this.session.events.find((e) => e.sequence === sequence) ?? null;

    return {
      events,
      currentEvent,
      progress: this.session.events.length > 0
        ? (sequence + 1) / this.session.events.length
        : 0,
    };
  }

  /**
   * Get a diff between two points in the timeline.
   */
  getDiff(fromSequence: number, toSequence: number): {
    added: ErgenekonEvent[];
    range: [number, number];
  } {
    if (!this.session) throw new Error('No recording loaded');

    const added = this.session.events.filter(
      (e) => e.sequence > fromSequence && e.sequence <= toSequence
    );

    return { added, range: [fromSequence, toSequence] };
  }

  // ── Full Replay ─────────────────────────────────────────────────

  /**
   * Execute a full replay using a request handler function.
   *
   * The handler should be your Express app or equivalent — we'll send
   * the recorded request through it and capture the response.
   */
  async replay(
    handler: (req: MockRequest) => Promise<MockResponse>
  ): Promise<ReplayResult> {
    if (!this.session || !this.mockLayer) {
      throw new Error('No recording loaded');
    }

    const startTime = Date.now();
    const requestEvent = this.mockLayer.getRequestEvent();
    const responseEvent = this.mockLayer.getResponseEvent();

    if (!requestEvent) {
      return {
        success: false,
        replayedResponse: null,
        originalResponse: null,
        differences: ['No request event found in recording'],
        eventsConsumed: 0,
        eventsRemaining: this.mockLayer.remaining,
        replayDurationMs: Date.now() - startTime,
        error: 'No request event in recording',
      };
    }

    // Reconstruct the original request
    const mockReq: MockRequest = {
      method: requestEvent.data['method'] as string,
      url: requestEvent.data['url'] as string,
      path: requestEvent.data['path'] as string,
      headers: requestEvent.data['headers'] as Record<string, string>,
      body: requestEvent.data['body'],
      query: requestEvent.data['query'] as Record<string, string>,
    };

    const originalResponse = responseEvent
      ? {
          statusCode: responseEvent.data['statusCode'] as number,
          headers: responseEvent.data['headers'] as Record<string, unknown>,
          body: responseEvent.data['body'],
        }
      : null;

    try {
      // Install mocks and run the handler
      const replayedResponse = await this.withMocks(() => handler(mockReq));

      // Compare responses
      const differences: string[] = [];

      if (originalResponse) {
        if (replayedResponse.statusCode !== originalResponse.statusCode) {
          differences.push(
            `Status code: original=${originalResponse.statusCode}, replayed=${replayedResponse.statusCode}`
          );
        }

        const originalBody = JSON.stringify(originalResponse.body);
        const replayedBody = JSON.stringify(replayedResponse.body);
        if (originalBody !== replayedBody) {
          differences.push('Response body differs');
        }
      }

      return {
        success: differences.length === 0,
        replayedResponse: {
          statusCode: replayedResponse.statusCode,
          headers: replayedResponse.headers,
          body: replayedResponse.body,
        },
        originalResponse,
        differences,
        eventsConsumed: this.session.events.length - this.mockLayer.remaining,
        eventsRemaining: this.mockLayer.remaining,
        replayDurationMs: Date.now() - startTime,
        error: null,
      };
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      return {
        success: false,
        replayedResponse: null,
        originalResponse,
        differences: [error.message],
        eventsConsumed: this.session.events.length - this.mockLayer.remaining,
        eventsRemaining: this.mockLayer.remaining,
        replayDurationMs: Date.now() - startTime,
        error: error.message,
      };
    }
  }

  /**
   * Run a function with the mock layer installed.
   * Replaces Date.now, Math.random, and fetch with mocked versions.
   */
  private async withMocks<T>(fn: () => Promise<T>): Promise<T> {
    const mock = this.mockLayer!;
    const origDateNow = Date.now;
    const origMathRandom = Math.random;
    const origFetch = globalThis.fetch;

    try {
      // Install mocks
      Date.now = () => mock.mockDateNow();
      Math.random = () => mock.mockMathRandom();

      globalThis.fetch = (async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
        const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
        const mockResponse = mock.mockFetch(url);

        if (!mockResponse) {
          throw new ReplayDivergenceError('http_response_in', 'fetch_call', 0,
            `Unexpected fetch call to ${url} — not in recording`);
        }

        return new Response(JSON.stringify(mockResponse.body), {
          status: mockResponse.status,
          statusText: mockResponse.statusText,
          headers: mockResponse.headers,
        });
      }) as typeof globalThis.fetch;

      return await fn();
    } finally {
      // Always restore originals
      Date.now = origDateNow;
      Math.random = origMathRandom;
      globalThis.fetch = origFetch;
    }
  }
}

/** Simplified request object for replay */
export interface MockRequest {
  method: string;
  url: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
  query: Record<string, string>;
}

/** Simplified response object from replay */
export interface MockResponse {
  statusCode: number;
  headers: Record<string, unknown>;
  body: unknown;
}
