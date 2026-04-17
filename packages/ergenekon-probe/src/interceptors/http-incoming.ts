// ============================================================================
// ERGENEKON PROBE — HTTP Incoming Interceptor
//
// Express middleware that captures incoming requests and outgoing responses.
// This is the "front door" — the first and last events in every recording.
//
// Creates a RecordingSession for each request and propagates it through
// the entire async call chain via AsyncLocalStorage.
// ============================================================================

import type { Request, Response, NextFunction } from 'express';
import type { ProbeConfig } from '@ergenekon/core';
import { HybridLogicalClock, ulid } from '@ergenekon/core';
import { RecordingSession, runWithSession } from '../recording-context.js';
import { originalDateNow } from './globals.js';
import { randomBytes } from 'node:crypto';
import type { SamplingEngine, SamplingDecision } from '../sampling.js';
import { redactDeep, redactHeaders } from '../redaction.js';

// W3C Trace Context header names
const TRACEPARENT_HEADER = 'traceparent';
const ERGENEKON_HLC_HEADER = 'x-ergenekon-hlc';

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
 * SECURITY (HIGH-26): Uses crypto.randomBytes instead of Math.random
 */
function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/**
 * Generate a 32-character hex trace ID.
 * SECURITY (HIGH-26): Uses crypto.randomBytes instead of Math.random
 */
function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}


export type SessionCallback = (session: import('@ergenekon/core').RecordingSession) => void;

/**
 * Creates the Express middleware that records incoming HTTP requests.
 */
export function createHttpIncomingMiddleware(
  config: ProbeConfig,
  hlc: HybridLogicalClock,
  onSessionComplete: SessionCallback,
  samplingEngine?: SamplingEngine
) {
  return function ergenekonMiddleware(req: Request, res: Response, next: NextFunction): void {
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
      // SECURITY (HIGH-33): Use crypto.randomBytes for uniform distribution
      const rand = randomBytes(4).readUInt32BE(0) / 0xFFFFFFFF;
      if (rand > config.samplingRate) {
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
    const remoteHlcHeader = req.headers[ERGENEKON_HLC_HEADER] as string | undefined;
    if (remoteHlcHeader && remoteHlcHeader.length < 256) { // hard limit on header size
      try {
        const remoteHlc = JSON.parse(remoteHlcHeader, (key, value) => {
          if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
          return value;
        });
        // SECURITY: Validate HLC structure to prevent clock manipulation
        // and prototype pollution attacks
        if (
          remoteHlc &&
          typeof remoteHlc === 'object' &&
          !Array.isArray(remoteHlc) &&
          typeof remoteHlc.wallTime === 'number' &&
          typeof remoteHlc.logical === 'number' &&
          Number.isFinite(remoteHlc.wallTime) &&
          Number.isFinite(remoteHlc.logical) &&
          remoteHlc.logical >= 0 &&
          remoteHlc.logical <= 65535 && // logical counter sanity cap
          Math.abs(remoteHlc.wallTime - Date.now()) < 86400000 // within ±24h
        ) {
          hlc.receive({ wallTime: remoteHlc.wallTime, logical: remoteHlc.logical, nodeId: String(remoteHlc.nodeId || 'remote') });
        }
        // else: silently discard — don't let attackers manipulate our clock
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
      // SECURITY: IP addresses are PII — redact to prevent data exposure
      ip: '[REDACTED]',
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
            // SECURITY: Prototype pollution guard on response body
            responseBody = JSON.parse(chunk, (key, value) => {
              if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
              return value;
            });
          } catch {
            responseBody = chunk;
          }
        } else if (Buffer.isBuffer(chunk)) {
          try {
            responseBody = JSON.parse(chunk.toString('utf-8'), (key, value) => {
              if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
              return value;
            });
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
