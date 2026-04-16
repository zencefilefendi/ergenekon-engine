// ============================================================================
// ERGENEKON PROBE — HTTP Outgoing Interceptor
//
// Monkey-patches globalThis.fetch to capture all outgoing HTTP calls.
// When a service calls another service (or any external API), we record
// both the request and response for deterministic replay.
// ============================================================================

import { getActiveSession } from '../recording-context.js';
import { originalDateNow } from './globals.js';

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

    // Record outgoing request
    session.record('http_request_out', `${method} ${url}`, {
      url,
      method,
      headers: Object.fromEntries(headers.entries()),
      body: init?.body ? String(init.body) : null,
    });

    const start = originalDateNow();

    try {
      const response = await _originalFetch(input, { ...init, headers });
      const durationMs = originalDateNow() - start;

      // Clone response to read body without consuming it
      const cloned = response.clone();
      let responseBody: unknown;
      try {
        responseBody = await cloned.json();
      } catch {
        try {
          responseBody = await cloned.text();
        } catch {
          responseBody = null;
        }
      }

      session.record(
        'http_response_in',
        `${response.status} ${method} ${url}`,
        {
          status: response.status,
          statusText: response.statusText,
          headers: Object.fromEntries(response.headers.entries()),
          body: responseBody,
        },
        { durationMs }
      );

      return response;
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
