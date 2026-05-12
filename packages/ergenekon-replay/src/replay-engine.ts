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

let isReplaying = false;

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
    this.session = JSON.parse(data, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
      return value;
    }) as RecordingSession;
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

    return this.session.events.map((event: ErgenekonEvent) => ({
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

    const events = this.session.events.filter((e: ErgenekonEvent) => e.sequence <= sequence);
    const currentEvent = this.session.events.find((e: ErgenekonEvent) => e.sequence === sequence) ?? null;

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
      (e: ErgenekonEvent) => e.sequence > fromSequence && e.sequence <= toSequence
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

    // SECURITY (CRIT-21): Prevent concurrent execution since we use global mocks
    if (isReplaying) {
      throw new Error('[SECURITY] Concurrent replay detected. ReplayEngine modifies global environment and cannot be run in parallel within the same process.');
    }
    isReplaying = true;

    const startTime = Date.now();
    const requestEvent = this.mockLayer.getRequestEvent();
    const responseEvent = this.mockLayer.getResponseEvent();

    if (!requestEvent) {
      isReplaying = false;
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
    } finally {
      isReplaying = false;
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

    // SECURITY (H-30): Aggressive I/O sandboxing in replay mode.
    // We must block modules that could leak secrets or execute arbitrary code
    // if an attacker provides a malicious recording.
    const Module = require('node:module');
    const originalRequire = Module.prototype.require;
    const originalMainModule = process.mainModule;

    try {
      // Sandbox requires
      Module.prototype.require = function(id: string) {
        if (id === 'fs' || id === 'node:fs' || id === 'fs/promises' || id === 'node:fs/promises' ||
            id === 'child_process' || id === 'node:child_process' ||
            id === 'net' || id === 'node:net' ||
            id === 'dns' || id === 'node:dns' ||
            id === 'http' || id === 'node:http' ||
            id === 'https' || id === 'node:https' ||
            id === 'vm' || id === 'node:vm' ||
            id === 'worker_threads' || id === 'node:worker_threads' ||
            id === 'os' || id === 'node:os' ||
            id === 'module' || id === 'node:module') {
          throw new Error(`[SECURITY] Replay Engine blocked access to sensitive module '${id}' to prevent I/O or execution escape.`);
        }
        return originalRequire.apply(this, arguments);
      };

      // Neuter process.mainModule to prevent it from being used to bypass the require hook
      Object.defineProperty(process, 'mainModule', {
        get: () => undefined,
        configurable: true
      });

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
      Module.prototype.require = originalRequire;
      if (originalMainModule !== undefined) {
        Object.defineProperty(process, 'mainModule', {
          value: originalMainModule,
          configurable: true,
          writable: true
        });
      } else {
        delete (process as any).mainModule;
      }
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
