// ============================================================================
// ERGENEKON PROBE — HTTP Outgoing Interceptor
//
// Monkey-patches globalThis.fetch to capture all outgoing HTTP calls.
// When a service calls another service (or any external API), we record
// both the request and response for deterministic replay.
// ============================================================================

import { getActiveSession } from '../recording-context.js';
import { originalDateNow } from './globals.js';
import { redactDeep, redactHeaders } from '../redaction.js';

let installed = false;
let _originalFetch: typeof globalThis.fetch;

/**
 * Install the fetch interceptor.
 * Captures all outgoing HTTP requests made via fetch().
 */
export function installFetchInterceptor(): void {
  if (installed) return;
  if (typeof globalThis.fetch !== 'function') return; // No native fetch
  installed = true;

  _originalFetch = globalThis.fetch;

  globalThis.fetch = async function ergenekonFetch(
    input: Parameters<typeof globalThis.fetch>[0],
    init?: RequestInit
  ): Promise<Response> {
    const session = getActiveSession();

    // No active recording — pass through with zero overhead
    if (!session) {
      return _originalFetch(input, init);
    }

    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');

    // Inject trace context headers
    const headers = new Headers(init?.headers);
    headers.set('traceparent', `00-${session.traceId}-${session.spanId}-01`);
    headers.set('x-ergenekon-hlc', JSON.stringify(session['hlc'].peek()));

    // Record outgoing request — SECURITY (CRIT-03): redact secrets
    session.record('http_request_out', `${method} ${url}`, {
      url,
      method,
      headers: redactHeaders(Object.fromEntries(headers.entries()), []),
      body: init?.body ? redactDeep(String(init.body)) : null,
    });

    const start = originalDateNow();

    try {
      const response = await _originalFetch(input, { ...init, headers });
      const durationMs = originalDateNow() - start;

      const safeHeaders = redactHeaders(Object.fromEntries(response.headers.entries()), []);

      // Fast response head recording (doesn't block on body)
      session.record(
        'http_response_in',
        `${response.status} ${method} ${url}`,
        {
          status: response.status,
          statusText: response.statusText,
          headers: safeHeaders,
          body: '[STREAMING]'
        },
        { durationMs }
      );

      if (!response.body) {
        return response;
      }

      // Tee the stream to avoid buffering unbounded payloads
      const [userStream, probeStream] = response.body.tee();

      // Background consume the body
      (async () => {
        try {
          const reader = probeStream.getReader();
          const chunks: Uint8Array[] = [];
          let totalSize = 0;
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value && totalSize < 65536) { // max 64kb
              chunks.push(value);
              totalSize += value.length;
            }
          }
          if (chunks.length > 0) {
            const buffer = Buffer.concat(chunks);
            let bodyData: unknown;
            try {
              bodyData = JSON.parse(buffer.toString('utf-8'));
            } catch {
              bodyData = buffer.toString('utf-8');
            }
            session.record('http_response_in_body', `Body: ${method} ${url}`, {
              body: redactDeep(bodyData)
            });
          }
        } catch {
          // ignore stream read failures
        }
      })();

      // Construct identical Response object replacing the body with user stream
      return new Response(userStream, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
      });
    } catch (err) {
      const durationMs = originalDateNow() - start;
      const error = err instanceof Error ? err : new Error(String(err));

      session.record(
        'http_response_in',
        `ERROR ${method} ${url}`,
        {
          url,
          method,
          error: {
            name: error.name,
            message: error.message,
          },
        },
        {
          durationMs,
          error: {
            name: error.name,
            message: error.message,
            stack: error.stack ?? null,
          },
        }
      );

      throw err;
    }
  };
}

/**
 * Uninstall the fetch interceptor. Restores original fetch.
 */
export function uninstallFetchInterceptor(): void {
  if (!installed) return;
  installed = false;
  globalThis.fetch = _originalFetch;
}
