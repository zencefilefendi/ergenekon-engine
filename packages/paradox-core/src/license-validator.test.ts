// ============================================================================
// PARADOX ENGINE — License System Tests
//
// Comprehensive test suite for the Ed25519 license system:
//   1. Key generation + signing
//   2. Signature verification
//   3. Tampering detection
//   4. Expiration handling
//   5. Tier-based feature resolution
//   6. License file discovery
//   7. Graceful Community fallback
// ============================================================================

import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { generateLicense, generateLicenseJSON } from './license-generator.js';
import { validateLicense, hasFeature, isAtLeastTier, loadLicense, getTierDisplay } from './license-validator.js';
import type { LicenseValidation, SignedLicense } from './license-types.js';
import { TIER_FEATURES, TIER_LIMITS } from './license-types.js';
import { writeFileSync, unlinkSync, existsSync } from 'node:fs';

// The test private key — ONLY used in tests, never in production
const TEST_PRIVATE_KEY = `-----BEGIN PRIVATE KEY-----
***REDACTED_OLD_KEY***
-----END PRIVATE KEY-----`;

// ── Helpers ────────────────────────────────────────────────────────

function createValidProLicense(): SignedLicense {
  return generateLicense({
    customerId: 'cus_test_123',
    customerEmail: 'test@paradox.dev',
    customerName: 'Test Corp',
    tier: 'pro',
    durationDays: 365,
  }, TEST_PRIVATE_KEY);
}

function createValidEnterpriseLicense(): SignedLicense {
  return generateLicense({
    customerId: 'cus_ent_456',
    customerEmail: 'admin@bigcorp.com',
    customerName: 'BigCorp Industries',
    tier: 'enterprise',
    durationDays: 365,
  }, TEST_PRIVATE_KEY);
}

function createExpiredLicense(): SignedLicense {
  return generateLicense({
    customerId: 'cus_expired',
    customerEmail: 'old@company.com',
    customerName: 'Expired Inc',
    tier: 'pro',
    durationDays: -30, // 30 days in the past
  }, TEST_PRIVATE_KEY);
}

// ── Test Suite ─────────────────────────────────────────────────────

describe('License Generator', () => {
  it('generates a valid signed license with all required fields', () => {
    const signed = createValidProLicense();

    expect(signed.payload).toBeDefined();
    expect(signed.signature).toBeDefined();
    expect(signed.payload.version).toBe(1);
    expect(signed.payload.licenseId).toMatch(/^lic_/);
    expect(signed.payload.customerId).toBe('cus_test_123');
    expect(signed.payload.customerEmail).toBe('test@paradox.dev');
    expect(signed.payload.customerName).toBe('Test Corp');
    expect(signed.payload.tier).toBe('pro');
    expect(signed.payload.features).toEqual(TIER_FEATURES.pro);
    expect(signed.payload.issuedAt).toBeTruthy();
    expect(signed.payload.expiresAt).toBeTruthy();
    expect(signed.signature.length).toBeGreaterThan(20);
  });

  it('generates different license IDs for each call', () => {
    const a = createValidProLicense();
    const b = createValidProLicense();
    expect(a.payload.licenseId).not.toBe(b.payload.licenseId);
  });

  it('produces valid JSON output', () => {
    const json = generateLicenseJSON({
      customerId: 'cus_json',
      customerEmail: 'json@test.com',
      customerName: 'JSON Corp',
      tier: 'pro',
    }, TEST_PRIVATE_KEY);

    const parsed = JSON.parse(json);
    expect(parsed.payload).toBeDefined();
    expect(parsed.signature).toBeDefined();
  });

  it('throws when no private key is available', () => {
    const originalEnv = process.env.PARADOX_SIGNING_KEY;
    delete process.env.PARADOX_SIGNING_KEY;

    expect(() => generateLicense({
      customerId: 'cus_nokey',
      customerEmail: 'nokey@test.com',
      customerName: 'NoKey Corp',
      tier: 'pro',
    })).toThrow('PARADOX_SIGNING_KEY');

    if (originalEnv) process.env.PARADOX_SIGNING_KEY = originalEnv;
  });

  it('respects custom maxServices and maxEventsPerDay', () => {
    const signed = generateLicense({
      customerId: 'cus_custom',
      customerEmail: 'custom@test.com',
      customerName: 'Custom Corp',
      tier: 'pro',
      maxServices: 5,
      maxEventsPerDay: 50000,
    }, TEST_PRIVATE_KEY);

    expect(signed.payload.maxServices).toBe(5);
    expect(signed.payload.maxEventsPerDay).toBe(50000);
  });

  it('allows custom feature list override', () => {
    const signed = generateLicense({
      customerId: 'cus_feat',
      customerEmail: 'feat@test.com',
      customerName: 'Feature Corp',
      tier: 'pro',
      features: ['single_service_replay', 'smart_sampling'],
    }, TEST_PRIVATE_KEY);

    expect(signed.payload.features).toEqual(['single_service_replay', 'smart_sampling']);
  });
});

describe('License Validator', () => {
  describe('valid license verification', () => {
    it('validates a properly signed Pro license', () => {
      const signed = createValidProLicense();
      const result = validateLicense(JSON.stringify(signed));

      expect(result.valid).toBe(true);
      expect(result.tier).toBe('pro');
      expect(result.license).not.toBeNull();
      expect(result.license!.customerEmail).toBe('test@paradox.dev');
      expect(result.error).toBeNull();
      expect(result.daysUntilExpiry).toBeGreaterThan(360);
    });

    it('validates a properly signed Enterprise license', () => {
      const signed = createValidEnterpriseLicense();
      const result = validateLicense(JSON.stringify(signed));

      expect(result.valid).toBe(true);
      expect(result.tier).toBe('enterprise');
      expect(result.features).toContain('sso_saml');
      expect(result.features).toContain('rbac');
      expect(result.features).toContain('unlimited_retention');
    });

    it('resolves Pro tier features correctly', () => {
      const signed = createValidProLicense();
      const result = validateLicense(JSON.stringify(signed));

      expect(result.features).toContain('distributed_replay');
      expect(result.features).toContain('smart_sampling');
      expect(result.features).toContain('deep_redaction');
      expect(result.features).toContain('time_travel_ui');
      expect(result.features).toContain('fs_interceptor');
      expect(result.features).toContain('dns_interceptor');
      expect(result.features).toContain('database_interceptor');
      // Should NOT have enterprise features
      expect(result.features).not.toContain('sso_saml');
      expect(result.features).not.toContain('unlimited_retention');
    });

    it('resolves limits from tier defaults', () => {
      const signed = createValidProLicense();
      const result = validateLicense(JSON.stringify(signed));

      expect(result.limits.maxServices).toBe(-1); // unlimited for pro
      expect(result.limits.maxRetentionHours).toBe(720); // 30 days
      expect(result.limits.rateLimitPerMinute).toBe(10_000);
    });

    it('uses explicit maxServices/maxEventsPerDay over tier defaults', () => {
      const signed = generateLicense({
        customerId: 'cus_limits',
        customerEmail: 'limits@test.com',
        customerName: 'Limits Corp',
        tier: 'pro',
        maxServices: 3,
        maxEventsPerDay: 5000,
      }, TEST_PRIVATE_KEY);

      const result = validateLicense(JSON.stringify(signed));
      expect(result.limits.maxServices).toBe(3);
      expect(result.limits.maxEventsPerDay).toBe(5000);
    });
  });

  describe('tamper detection', () => {
    it('rejects a license with modified email', () => {
      const signed = createValidProLicense();
      signed.payload.customerEmail = 'hacker@evil.com';  // tamper!

      const result = validateLicense(JSON.stringify(signed));
      expect(result.valid).toBe(false);
      expect(result.tier).toBe('community');
      expect(result.error).toContain('signature verification failed');
    });

    it('rejects a license with modified tier', () => {
      const signed = createValidProLicense();
      (signed as any).payload.tier = 'enterprise';  // try to upgrade!

      const result = validateLicense(JSON.stringify(signed));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('signature verification failed');
    });

    it('rejects a license with modified features', () => {
      const signed = createValidProLicense();
      signed.payload.features.push('sso_saml' as any);  // add enterprise feature

      const result = validateLicense(JSON.stringify(signed));
      expect(result.valid).toBe(false);
    });

    it('rejects a license with modified expiration', () => {
      const signed = createValidProLicense();
      signed.payload.expiresAt = '2099-12-31T23:59:59.999Z';  // extend!

      const result = validateLicense(JSON.stringify(signed));
      expect(result.valid).toBe(false);
    });

    it('rejects a license with garbage signature', () => {
      const signed = createValidProLicense();
      signed.signature = 'dGhpcyBpcyBub3QgYSB2YWxpZCBzaWduYXR1cmU=';

      const result = validateLicense(JSON.stringify(signed));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('signature verification failed');
    });
  });

  describe('expiration handling', () => {
    it('rejects an expired license', () => {
      const signed = createExpiredLicense();
      const result = validateLicense(JSON.stringify(signed));

      expect(result.valid).toBe(false);
      expect(result.tier).toBe('community');
      expect(result.error).toContain('expired');
    });

    it('reports days until expiry for valid license', () => {
      const signed = createValidProLicense();
      const result = validateLicense(JSON.stringify(signed));

      expect(result.daysUntilExpiry).toBeGreaterThan(360);
      expect(result.daysUntilExpiry).toBeLessThanOrEqual(366);
    });
  });

  describe('invalid input handling', () => {
    it('returns community for non-JSON input', () => {
      const result = validateLicense('this is not json');
      expect(result.valid).toBe(false);
      expect(result.tier).toBe('community');
      expect(result.error).toContain('not valid JSON');
    });

    it('returns community for missing payload', () => {
      const result = validateLicense(JSON.stringify({ signature: 'abc' }));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('missing payload');
    });

    it('returns community for missing signature', () => {
      const result = validateLicense(JSON.stringify({ payload: {} }));
      expect(result.valid).toBe(false);
      expect(result.error).toContain('missing payload or signature');
    });

    it('returns community for unsupported version', () => {
      const signed = createValidProLicense();
      (signed as any).payload.version = 99;
      const result = validateLicense(JSON.stringify(signed));
      // Will fail signature check because payload was modified
      expect(result.valid).toBe(false);
    });

    it('returns community for empty string', () => {
      const result = validateLicense('');
      expect(result.valid).toBe(false);
    });
  });

  describe('community fallback', () => {
    it('community validation has correct features', () => {
      const result = validateLicense('not json');
      expect(result.features).toEqual(TIER_FEATURES.community);
      expect(result.features).toContain('single_service_replay');
      expect(result.features).toContain('basic_cli');
      expect(result.features).not.toContain('distributed_replay');
    });

    it('community validation has correct limits', () => {
      const result = validateLicense('not json');
      expect(result.limits.maxServices).toBe(1);
      expect(result.limits.maxEventsPerDay).toBe(10_000);
      expect(result.limits.maxRetentionHours).toBe(24);
      expect(result.limits.maxSessions).toBe(100);
    });
  });
});

describe('Helper Functions', () => {
  it('hasFeature returns true for included features', () => {
    const signed = createValidProLicense();
    const result = validateLicense(JSON.stringify(signed));

    expect(hasFeature(result, 'distributed_replay')).toBe(true);
    expect(hasFeature(result, 'smart_sampling')).toBe(true);
  });

  it('hasFeature returns false for excluded features', () => {
    const signed = createValidProLicense();
    const result = validateLicense(JSON.stringify(signed));

    expect(hasFeature(result, 'sso_saml')).toBe(false);
    expect(hasFeature(result, 'unlimited_retention')).toBe(false);
  });

  it('isAtLeastTier works correctly', () => {
    const proResult = validateLicense(JSON.stringify(createValidProLicense()));
    expect(isAtLeastTier(proResult, 'community')).toBe(true);
    expect(isAtLeastTier(proResult, 'pro')).toBe(true);
    expect(isAtLeastTier(proResult, 'enterprise')).toBe(false);

    const entResult = validateLicense(JSON.stringify(createValidEnterpriseLicense()));
    expect(isAtLeastTier(entResult, 'community')).toBe(true);
    expect(isAtLeastTier(entResult, 'pro')).toBe(true);
    expect(isAtLeastTier(entResult, 'enterprise')).toBe(true);
  });

  it('getTierDisplay returns emoji-prefixed names', () => {
    expect(getTierDisplay('community')).toBe('🆓 Community');
    expect(getTierDisplay('pro')).toBe('⚡ Pro');
    expect(getTierDisplay('enterprise')).toBe('🏢 Enterprise');
  });
});

describe('License File Discovery', () => {
  const testLicensePath = '.paradox-license.json';

  afterEach(() => {
    // Clean up test license file
    try {
      if (existsSync(testLicensePath)) unlinkSync(testLicensePath);
    } catch { /* ignore */ }
    // Clean up env vars
    delete process.env.PARADOX_LICENSE_KEY;
    delete process.env.PARADOX_LICENSE;
  });

  it('loadLicense returns community when no license file exists', () => {
    const result = loadLicense();
    expect(result.tier).toBe('community');
    expect(result.valid).toBe(true); // community with no file is valid, not an error
    expect(result.error).toBeNull();
  });

  it('loadLicense reads from PARADOX_LICENSE_KEY env var', () => {
    const signed = createValidProLicense();
    process.env.PARADOX_LICENSE_KEY = JSON.stringify(signed);

    const result = loadLicense();
    expect(result.valid).toBe(true);
    expect(result.tier).toBe('pro');
  });

  it('loadLicense reads from .paradox-license.json file', () => {
    const signed = createValidProLicense();
    writeFileSync(testLicensePath, JSON.stringify(signed, null, 2));

    const result = loadLicense();
    expect(result.valid).toBe(true);
    expect(result.tier).toBe('pro');
  });

  it('PARADOX_LICENSE_KEY env var takes priority over file', () => {
    // Write a pro license to file
    const proSigned = createValidProLicense();
    writeFileSync(testLicensePath, JSON.stringify(proSigned, null, 2));

    // Set enterprise license in env var
    const entSigned = createValidEnterpriseLicense();
    process.env.PARADOX_LICENSE_KEY = JSON.stringify(entSigned);

    const result = loadLicense();
    expect(result.tier).toBe('enterprise'); // env var wins
  });
});

describe('Roundtrip Integrity', () => {
  it('generate → JSON → parse → validate roundtrip is always valid', () => {
    const tiers: Array<'pro' | 'enterprise'> = ['pro', 'enterprise'];

    for (const tier of tiers) {
      const signed = generateLicense({
        customerId: `cus_${tier}`,
        customerEmail: `${tier}@test.com`,
        customerName: `${tier} Corp`,
        tier,
        durationDays: 365,
      }, TEST_PRIVATE_KEY);

      // Serialize → deserialize → validate
      const json = JSON.stringify(signed);
      const result = validateLicense(json);

      expect(result.valid).toBe(true);
      expect(result.tier).toBe(tier);
      expect(result.error).toBeNull();
    }
  });

  it('generateLicenseJSON output validates correctly', () => {
    const json = generateLicenseJSON({
      customerId: 'cus_roundtrip',
      customerEmail: 'rt@test.com',
      customerName: 'Roundtrip Inc',
      tier: 'pro',
    }, TEST_PRIVATE_KEY);

    const result = validateLicense(json);
    expect(result.valid).toBe(true);
    expect(result.tier).toBe('pro');
  });
});

describe('Tier Features Configuration', () => {
  it('community tier has minimal features', () => {
    expect(TIER_FEATURES.community).toHaveLength(2);
    expect(TIER_FEATURES.community).toContain('single_service_replay');
    expect(TIER_FEATURES.community).toContain('basic_cli');
  });

  it('pro tier includes all community features', () => {
    for (const feature of TIER_FEATURES.community) {
      expect(TIER_FEATURES.pro).toContain(feature);
    }
  });

  it('enterprise tier includes all pro features', () => {
    for (const feature of TIER_FEATURES.pro) {
      expect(TIER_FEATURES.enterprise).toContain(feature);
    }
  });

  it('enterprise has exclusive features', () => {
    const enterpriseOnly = TIER_FEATURES.enterprise.filter(
      f => !TIER_FEATURES.pro.includes(f)
    );
    expect(enterpriseOnly.length).toBeGreaterThan(0);
    expect(enterpriseOnly).toContain('sso_saml');
    expect(enterpriseOnly).toContain('rbac');
  });

  it('tier limits are progressively more generous', () => {
    expect(TIER_LIMITS.community.maxServices).toBe(1);
    expect(TIER_LIMITS.pro.maxServices).toBe(-1);
    expect(TIER_LIMITS.enterprise.maxServices).toBe(-1);

    expect(TIER_LIMITS.community.maxRetentionHours).toBeLessThan(
      TIER_LIMITS.pro.maxRetentionHours
    );
  });
});
