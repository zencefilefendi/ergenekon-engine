// ============================================================================
// PARADOX PROBE — HTTP Incoming Interceptor
//
// Express middleware that captures incoming requests and outgoing responses.
// This is the "front door" — the first and last events in every recording.
//
// Creates a RecordingSession for each request and propagates it through
// the entire async call chain via AsyncLocalStorage.
// ============================================================================

import type { Request, Response, NextFunction } from 'express';
import type { ProbeConfig } from '@paradox/core';
import { HybridLogicalClock, ulid } from '@paradox/core';
import { RecordingSession, runWithSession } from '../recording-context.js';
import { originalDateNow } from './globals.js';
import type { SamplingEngine, SamplingDecision } from '../sampling.js';
import { redactDeep, redactHeaders } from '../redaction.js';

// W3C Trace Context header names
const TRACEPARENT_HEADER = 'traceparent';
const PARADOX_HLC_HEADER = 'x-paradox-hlc';

/**
 * Parse W3C traceparent header: "00-traceId-parentId-flags"
 */
function parseTraceparent(header: string | undefined): { traceId: string; parentSpanId: string } | null {
  if (!header) return null;
  const parts = header.split('-');
  if (parts.length !== 4) return null;
  return { traceId: parts[1], parentSpanId: parts[2] };
}

/**
 * Generate a 16-character hex span ID.
 */
function generateSpanId(): string {
  const bytes = new Uint8Array(8);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Generate a 32-character hex trace ID.
 */
function generateTraceId(): string {
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}


export type SessionCallback = (session: import('@paradox/core').RecordingSession) => void;

/**
 * Creates the Express middleware that records incoming HTTP requests.
 */
export function createHttpIncomingMiddleware(
  config: ProbeConfig,
  hlc: HybridLogicalClock,
  onSessionComplete: SessionCallback,
  samplingEngine?: SamplingEngine
) {
  return function paradoxMiddleware(req: Request, res: Response, next: NextFunction): void {
    if (!config.enabled) {
      next();
      return;
    }

    // ── Smart Sampling: HEAD decision (at request start) ──────────
    const upstreamSampled = req.headers[TRACEPARENT_HEADER]
      ? (req.headers[TRACEPARENT_HEADER] as string).endsWith('-01')
      : false;
    const path = req.path;

    let headDecision: SamplingDecision | null = null;

    if (samplingEngine) {
      headDecision = samplingEngine.headDecision({ path, upstreamSampled });
      if (!headDecision.shouldRecord) {
        // HEAD says no — but we still need to let the request proceed
        // and check TAIL decision at response end (tail-based sampling).
        // We MUST still wrap the request to capture outcome for tail decision.
      }
    } else {
      // Legacy: simple random sampling (no SamplingEngine)
      if (Math.random() > config.samplingRate) {
        next();
        return;
      }
    }

    // Extract or generate trace context
    const traceContext = parseTraceparent(req.headers[TRACEPARENT_HEADER] as string | undefined);
    const traceId = traceContext?.traceId ?? generateTraceId();
    const parentSpanId = traceContext?.parentSpanId ?? null;
    const spanId = generateSpanId();

    // Receive remote HLC if present (distributed clock sync)
    const remoteHlcHeader = req.headers[PARADOX_HLC_HEADER] as string | undefined;
    if (remoteHlcHeader) {
      try {
        const remoteHlc = JSON.parse(remoteHlcHeader);
        hlc.receive(remoteHlc);
      } catch {
        // Malformed HLC header — ignore
      }
    }

    // Create recording session
    const session = new RecordingSession({
      traceId,
      spanId,
      parentSpanId,
      serviceName: config.serviceName,
      hlc,
    });

    // Record the incoming request (with deep redaction)
    session.record('http_request_in', `${req.method} ${req.path}`, {
      method: req.method,
      url: req.originalUrl,
      path: req.path,
      query: redactDeep(req.query, { fieldNames: config.redactFields }),
      headers: redactHeaders(req.headers as Record<string, string>, config.redactHeaders),
      body: redactDeep(req.body, { fieldNames: config.redactFields }),
      ip: req.ip,
    });

    // Set trace context headers on response (for downstream propagation)
    res.setHeader(TRACEPARENT_HEADER, `00-${traceId}-${spanId}-01`);

    // Intercept response.end to capture outgoing response
    const originalEnd = res.end;
    const requestStart = originalDateNow();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    res.end = function (chunk?: any, encoding?: any, callback?: any): Response {
      const durationMs = originalDateNow() - requestStart;

      // Capture response body
      let responseBody: unknown = undefined;
      if (chunk) {
        if (typeof chunk === 'string') {
          try {
            responseBody = JSON.parse(chunk);
          } catch {
            responseBody = chunk;
          }
        } else if (Buffer.isBuffer(chunk)) {
          try {
            responseBody = JSON.parse(chunk.toString('utf-8'));
          } catch {
            responseBody = chunk.toString('utf-8');
          }
        }
      }

      session.record(
        'http_response_out',
        `${res.statusCode} ${req.method} ${req.path}`,
        {
          statusCode: res.statusCode,
          headers: res.getHeaders(),
          body: redactDeep(responseBody, { fieldNames: config.redactFields }),
        },
        { durationMs }
      );

      // ── Smart Sampling: TAIL decision (at request end) ──────────
      if (samplingEngine && headDecision) {
        const tailDecision = samplingEngine.tailDecision(headDecision, {
          path: req.path,
          statusCode: res.statusCode,
          durationMs,
          hasError: res.statusCode >= 500,
        });

        if (!tailDecision.shouldRecord) {
          // Both HEAD and TAIL said no — discard the recording
          return originalEnd.call(this, chunk, encoding, callback) as unknown as Response;
        }
        // TAIL upgraded to yes (error, latency, etc.) — continue to emit
      }

      // Finalize and emit the recording
      const recording = session.finalize();
      onSessionComplete(recording);

      // Call original end
      return originalEnd.call(this, chunk, encoding, callback) as unknown as Response;
    };

    // Run the rest of the middleware chain within this session's context
    runWithSession(session, () => next());
  };
}
