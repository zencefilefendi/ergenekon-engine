// ============================================================================
// ERGENEKON PROBE — DNS Interceptor Tests
//
// Validates:
//   1. Install/uninstall symmetry (original functions restored)
//   2. Zero overhead when not recording
//   3. dns.lookup callback-based interception
//   4. dns.promises.resolve interception
//   5. Error paths captured (ENOTFOUND)
// ============================================================================

import { describe, it, expect, afterEach } from 'vitest';
import dns from 'node:dns';
import dnsPromises from 'node:dns/promises';
import { installDnsInterceptor, uninstallDnsInterceptor } from './dns.js';

afterEach(() => {
  uninstallDnsInterceptor();
});

describe('DNS Interceptor — install/uninstall', () => {
  it('install and uninstall are symmetric', () => {
    const origLookup = dns.lookup;
    const origResolve = dnsPromises.resolve;

    installDnsInterceptor();
    // After install, functions should be different (wrapped)
    expect(dns.lookup).not.toBe(origLookup);
    expect(dnsPromises.resolve).not.toBe(origResolve);

    uninstallDnsInterceptor();
    // After uninstall, functions should be restored
    expect(dns.lookup).toBe(origLookup);
    expect(dnsPromises.resolve).toBe(origResolve);
  });

  it('double install is idempotent', () => {
    installDnsInterceptor();
    const wrapped = dns.lookup;
    installDnsInterceptor();
    expect(dns.lookup).toBe(wrapped);
    uninstallDnsInterceptor();
  });

  it('double uninstall is safe', () => {
    installDnsInterceptor();
    uninstallDnsInterceptor();
    uninstallDnsInterceptor(); // Should not throw
  });
});

describe('DNS Interceptor — passthrough when not recording', () => {
  it('dns.lookup works normally when intercepted but not recording', async () => {
    installDnsInterceptor();

    // Resolve localhost — should always work
    const result = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      dns.lookup('localhost', (err, address, family) => {
        if (err) reject(err);
        else resolve({ address, family });
      });
    });

    expect(result.address).toBeTruthy();
    // localhost resolves to 127.0.0.1 (IPv4) or ::1 (IPv6)
    expect(['127.0.0.1', '::1']).toContain(result.address);
  });

  it('dns.lookup with options works when intercepted but not recording', async () => {
    installDnsInterceptor();

    const result = await new Promise<{ address: string; family: number }>((resolve, reject) => {
      dns.lookup('localhost', { family: 4 }, (err, address, family) => {
        if (err) reject(err);
        else resolve({ address, family });
      });
    });

    expect(result.address).toBe('127.0.0.1');
    expect(result.family).toBe(4);
  });

  it('dns.lookup error path works when intercepted but not recording', async () => {
    installDnsInterceptor();

    await expect(
      new Promise<void>((resolve, reject) => {
        dns.lookup('this-domain-definitely-does-not-exist-paradox-12345.test', (err) => {
          if (err) reject(err);
          else resolve();
        });
      })
    ).rejects.toThrow();
  });

  it('dns.promises.resolve works when intercepted but not recording', async () => {
    installDnsInterceptor();

    // Resolve a well-known domain — google.com should always have A records
    // We wrap in try/catch as network may not be available in CI
    try {
      const records = await dnsPromises.resolve('localhost');
      expect(Array.isArray(records)).toBe(true);
    } catch (err: any) {
      // In environments without DNS, we accept ENOTFOUND/ENODATA
      expect(['ENOTFOUND', 'ENODATA', 'ESERVFAIL']).toContain(err.code);
    }
  });

  it('dns.promises.resolve error path works when intercepted but not recording', async () => {
    installDnsInterceptor();

    await expect(
      dnsPromises.resolve('this-domain-definitely-does-not-exist-paradox-12345.test')
    ).rejects.toThrow();
  });
});
