// ============================================================================
// PARADOX ENGINE — License Validator
//
// Validates Ed25519-signed license tokens completely OFFLINE.
// No network calls, no phone-home, no telemetry.
//
// Security model:
//   - Public key is embedded in this file (safe to distribute)
//   - Private key exists ONLY on the license server (never in npm)
//   - Signatures are Ed25519 — quantum-resistant, fast, 64-byte
//   - License payload is JSON — human-readable, auditable
//
// Usage:
//   import { validateLicense, loadLicense } from '@paradox/core';
//   const result = loadLicense();
//   if (result.valid) console.log(`Pro features unlocked!`);
// ============================================================================

import { createPublicKey, verify } from 'node:crypto';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type {
  LicenseToken,
  LicenseFeature,
  LicenseTier,
  LicenseValidation,
  SignedLicense,
  TierLimits,
} from './license-types.js';
import {
  TIER_FEATURES,
  TIER_LIMITS,
  LICENSE_FILE_SEARCH_PATHS,
  LICENSE_ENV_VAR,
  LICENSE_INLINE_ENV_VAR,
} from './license-types.js';

// ── Embedded Ed25519 Public Key ────────────────────────────────────
// This is the PUBLIC key — safe to distribute in the npm package.
// The corresponding PRIVATE key exists only on the license generation server.
const PARADOX_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEA19R1JXWK+QMczbg35nJ7InM8LYzSx5Vcfi6NkhhV3Ow=
-----END PUBLIC KEY-----`;

// ── Community Fallback ─────────────────────────────────────────────

/** Returns a Community-tier validation result (used when no license found) */
function communityFallback(error: string | null = null): LicenseValidation {
  return {
    valid: error === null,
    license: null,
    tier: 'community',
    features: [...TIER_FEATURES.community],
    limits: { ...TIER_LIMITS.community },
    error,
    daysUntilExpiry: -1,
  };
}

// ── Core Validation ────────────────────────────────────────────────

/**
 * Validate a signed license token.
 *
 * Performs the following checks:
 *   1. JSON parse + structure validation
 *   2. Ed25519 signature verification
 *   3. Version check
 *   4. Expiration check
 *   5. Tier + feature resolution
 *
 * @param signedLicenseJson - The raw JSON string of the .paradox-license.json file
 * @returns LicenseValidation — always returns a result, never throws
 */
export function validateLicense(signedLicenseJson: string): LicenseValidation {
  // 1. Parse the signed license
  let signed: SignedLicense;
  try {
    signed = JSON.parse(signedLicenseJson) as SignedLicense;
  } catch {
    return communityFallback('Invalid license file: not valid JSON');
  }

  // 2. Structure check
  if (!signed.payload || !signed.signature) {
    return communityFallback('Invalid license file: missing payload or signature');
  }

  const { payload, signature } = signed;

  // 3. Version check
  if (payload.version !== 1) {
    return communityFallback(`Unsupported license version: ${payload.version}`);
  }

  // 4. Required fields
  if (!payload.licenseId || !payload.tier || !payload.issuedAt || !payload.expiresAt) {
    return communityFallback('Invalid license: missing required fields');
  }

  // 5. Tier validity
  if (!['community', 'pro', 'enterprise'].includes(payload.tier)) {
    return communityFallback(`Invalid license tier: ${payload.tier}`);
  }

  // 6. Verify Ed25519 signature
  try {
    const publicKey = createPublicKey(PARADOX_PUBLIC_KEY_PEM);
    const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8');
    const signatureBytes = Buffer.from(signature, 'base64');

    const isValid = verify(null, payloadBytes, publicKey, signatureBytes);

    if (!isValid) {
      return communityFallback('License signature verification failed — license may be tampered');
    }
  } catch (err) {
    return communityFallback(`Signature verification error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 7. Expiration check
  const expiresAt = new Date(payload.expiresAt);
  const now = new Date();
  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (expiresAt.getTime() < now.getTime()) {
    return communityFallback(`License expired on ${payload.expiresAt} (${Math.abs(daysUntilExpiry)} days ago)`);
  }

  // 8. Resolve features — use explicit features if provided, else tier defaults
  const features: LicenseFeature[] = payload.features.length > 0
    ? payload.features
    : [...TIER_FEATURES[payload.tier]];

  // 9. Resolve limits — use explicit values if provided (-1 means tier default)
  const tierLimits = TIER_LIMITS[payload.tier];
  const limits: TierLimits = {
    maxServices: payload.maxServices !== -1 ? payload.maxServices : tierLimits.maxServices,
    maxEventsPerDay: payload.maxEventsPerDay !== -1 ? payload.maxEventsPerDay : tierLimits.maxEventsPerDay,
    maxRetentionHours: tierLimits.maxRetentionHours,
    maxSessions: tierLimits.maxSessions,
    rateLimitPerMinute: tierLimits.rateLimitPerMinute,
  };

  return {
    valid: true,
    license: payload,
    tier: payload.tier,
    features,
    limits,
    error: null,
    daysUntilExpiry,
  };
}

// ── Feature & Limit Helpers ────────────────────────────────────────

/**
 * Check if a validated license includes a specific feature.
 */
export function hasFeature(validation: LicenseValidation, feature: LicenseFeature): boolean {
  return validation.features.includes(feature);
}

/**
 * Check if a license tier is at least the specified tier.
 */
export function isAtLeastTier(validation: LicenseValidation, minimumTier: LicenseTier): boolean {
  const tierOrder: Record<LicenseTier, number> = {
    community: 0,
    pro: 1,
    enterprise: 2,
  };
  return tierOrder[validation.tier] >= tierOrder[minimumTier];
}

/**
 * Get the tier display name with emoji.
 */
export function getTierDisplay(tier: LicenseTier): string {
  const displays: Record<LicenseTier, string> = {
    community: '🆓 Community',
    pro: '⚡ Pro',
    enterprise: '🏢 Enterprise',
  };
  return displays[tier];
}

// ── License File Discovery ─────────────────────────────────────────

/**
 * Search for and load a license file from standard locations.
 *
 * Search order:
 *   1. PARADOX_LICENSE_KEY env var (inline JSON)
 *   2. PARADOX_LICENSE env var (file path)
 *   3. .paradox-license.json in current directory
 *   4. paradox-license.json in current directory
 *   5. ~/.paradox-license.json in home directory
 *
 * If no license is found, returns Community-tier validation (not an error).
 */
export function loadLicense(): LicenseValidation {
  // 1. Check inline env var first
  const inlineKey = process.env[LICENSE_INLINE_ENV_VAR];
  if (inlineKey) {
    return validateLicense(inlineKey);
  }

  // 2. Check explicit file path env var
  const envPath = process.env[LICENSE_ENV_VAR];
  if (envPath) {
    try {
      const resolved = resolve(envPath);
      if (existsSync(resolved)) {
        const content = readFileSync(resolved, 'utf-8');
        return validateLicense(content);
      }
      return communityFallback(`License file not found at PARADOX_LICENSE path: ${envPath}`);
    } catch (err) {
      return communityFallback(`Error reading license file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Search standard paths
  for (const searchPath of LICENSE_FILE_SEARCH_PATHS) {
    try {
      const resolved = resolve(searchPath);
      if (existsSync(resolved)) {
        const content = readFileSync(resolved, 'utf-8');
        return validateLicense(content);
      }
    } catch {
      // Continue to next path
    }
  }

  // 4. No license found — Community mode (not an error)
  return communityFallback(null);
}
