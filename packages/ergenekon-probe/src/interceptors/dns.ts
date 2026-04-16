// ============================================================================
// ERGENEKON PROBE — DNS Interceptor
//
// Captures dns.lookup calls for deterministic replay.
// Flaky DNS is a real incident cause in fintech — stale DNS caches,
// split-horizon DNS, intermittent resolution failures.
//
// Intercepted operations:
//   - dns.lookup (used by http.request, net.connect, etc.)
//   - dns.promises.resolve
//
// Design:
//   - Preserves original function references for clean uninstall
//   - Zero overhead when not recording
//   - Records both successful resolutions and errors (NXDOMAIN, timeout)
//
// INVARIANT: installDnsInterceptor/uninstallDnsInterceptor are symmetric.
// ============================================================================

import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { getActiveSession } from '../recording-context.js';
import { originalDateNow } from '../internal-clock.js';

let installed = false;

// Original function references — stored as `any` to avoid overload/signature issues
let origLookup: typeof dns.lookup | null = null;
let origResolve: typeof dnsPromises.resolve | null = null;

/**
 * Install the DNS interceptor.
 * Captures dns.lookup and dns.promises.resolve.
 */
export function installDnsInterceptor(): void {
  if (installed) return;
  installed = true;

  // ── dns.lookup (callback-based, used by http/net internally) ────
  origLookup = dns.lookup;
  const savedLookup = origLookup;

  (dns as any).lookup = function ergenekonDnsLookup(
    hostname: string,
    optionsOrCallback: any,
    maybeCallback?: any,
  ): void {
    const session = getActiveSession();

    // Parse overloaded arguments: lookup(hostname, [options], callback)
    let options: dns.LookupOptions | undefined;
    let callback: Function;

    if (typeof optionsOrCallback === 'function') {
      callback = optionsOrCallback;
    } else {
      options = optionsOrCallback;
      callback = maybeCallback;
    }

    if (!session) {
      // No active recording — pass through
      if (options) {
        (savedLookup as any).call(dns, hostname, options, callback as any);
      } else {
        (savedLookup as any).call(dns, hostname, callback as any);
      }
      return;
    }

    session.record('dns_lookup', `dns.lookup(${hostname})`, {
      hostname,
      options: options ?? {},
    });

    const start = originalDateNow();

    const wrappedCallback = (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => {
      const durationMs = originalDateNow() - start;

      if (err) {
        session.record('dns_error', `dns.lookup(${hostname}) → ${err.code}`, {
          hostname,
          durationMs,
          error: { code: err.code, message: err.message },
        });
      } else {
        const addr = typeof address === 'string' ? address : JSON.stringify(address);
        session.record('dns_result', `dns.lookup(${hostname}) → ${addr} (${durationMs}ms)`, {
          hostname,
          durationMs,
          address,
          family,
        });
      }

      callback(err, address, family);
    };

    if (options) {
      (savedLookup as any).call(dns, hostname, options, wrappedCallback as any);
    } else {
      (savedLookup as any).call(dns, hostname, wrappedCallback as any);
    }
  };

  // ── dns.promises.resolve ───────────────────────────────────────
  origResolve = dnsPromises.resolve;
  const savedResolve = origResolve;

  (dnsPromises as any).resolve = async function ergenekonDnsResolve(
    hostname: string,
    rrtype?: string
  ): Promise<any> {
    const session = getActiveSession();

    if (!session) {
      return rrtype
        ? (savedResolve as any).call(dnsPromises, hostname, rrtype)
        : (savedResolve as any).call(dnsPromises, hostname);
    }

    session.record('dns_resolve', `dns.resolve(${hostname}, ${rrtype ?? 'A'})`, {
      hostname,
      rrtype: rrtype ?? 'A',
    });

    const start = originalDateNow();

    try {
      const result = rrtype
        ? await (savedResolve as any).call(dnsPromises, hostname, rrtype)
        : await (savedResolve as any).call(dnsPromises, hostname);
      const durationMs = originalDateNow() - start;

      session.record('dns_result', `dns.resolve(${hostname}) → ${JSON.stringify(result).slice(0, 200)} (${durationMs}ms)`, {
        hostname,
        rrtype: rrtype ?? 'A',
        durationMs,
        result,
      });

      return result;
    } catch (err) {
      const durationMs = originalDateNow() - start;

      session.record('dns_error', `dns.resolve(${hostname}) → error`, {
        hostname,
        rrtype: rrtype ?? 'A',
        durationMs,
        error: err instanceof Error ? { code: (err as any).code, message: err.message } : String(err),
      });

      throw err;
    }
  };
}

/**
 * Uninstall the DNS interceptor.
 * Restores original functions.
 */
export function uninstallDnsInterceptor(): void {
  if (!installed) return;
  installed = false;

  if (origLookup) {
    (dns as any).lookup = origLookup;
    origLookup = null;
  }
  if (origResolve) {
    (dnsPromises as any).resolve = origResolve;
    origResolve = null;
  }
}
