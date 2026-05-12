// ============================================================================
// ERGENEKON ENGINE — License Validator
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
//   import { validateLicense, loadLicense } from '@ergenekon/core';
//   const result = loadLicense();
//   if (result.valid) console.log(`Pro features unlocked!`);
// ============================================================================

import { createPublicKey, verify } from 'node:crypto';
import { readFileSync, existsSync, statSync } from 'node:fs';
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
  MAX_LICENSE_FILE_BYTES,
} from './license-types.js';

// ── Embedded Ed25519 Public Key ────────────────────────────────────
// This is the PUBLIC key — safe to distribute in the npm package.
// The corresponding PRIVATE key exists only on the license generation server.
const ERGENEKON_PUBLIC_KEY_PEM = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAm2DL8DjYG3R3HR5Dxib1gLa1AI6GlCd9ZkvrXTq5vCM=
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

// ── Recursive Deterministic JSON ──────────────────────────────────
// SECURITY (H-05): Recursively sorts keys to ensure canonical JSON
// without silently dropping nested objects, compliant with signing.
function stringifyCanonical(obj: unknown): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stringifyCanonical).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  let str = '{';
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i] as keyof typeof obj;
    if (i > 0) str += ',';
    str += JSON.stringify(key) + ':' + stringifyCanonical(obj[key]);
  }
  str += '}';
  return str;
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
 * @param signedLicenseJson - The raw JSON string of the .ergenekon-license.json file
 * @returns LicenseValidation — always returns a result, never throws
 */
export function validateLicense(signedLicenseJson: string): LicenseValidation {
  // 1. Parse the signed license
  let signed: SignedLicense;
  try {
    // SECURITY (MED-06): Prototype pollution guard
    signed = JSON.parse(signedLicenseJson, (key, value) => {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
      return value;
    }) as SignedLicense;
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
  if (!payload.licenseId || !payload.tier || !payload.issuedAt || !payload.expiresAt || !Array.isArray(payload.features)) {
    return communityFallback('Invalid license: missing required fields or features array');
  }

  // 5. Tier validity
  if (!['community', 'pro', 'enterprise'].includes(payload.tier)) {
    return communityFallback(`Invalid license tier: ${payload.tier}`);
  }

  // 6. Verify Ed25519 signature
  try {
    // SECURITY (H-04): In a real implementation, 'kid' would map to multiple public keys here
    const publicKeyPemToUse = process.env.NODE_ENV === 'test' && process.env.ERGENEKON_TEST_PUBLIC_KEY
      ? process.env.ERGENEKON_TEST_PUBLIC_KEY
      : ERGENEKON_PUBLIC_KEY_PEM;
    const publicKey = createPublicKey(publicKeyPemToUse);
    // SECURITY (CRIT-06/H-05): Verify against recursively sorted canonical JSON
    const canonicalJson = stringifyCanonical(payload);
    const payloadBytes = Buffer.from(canonicalJson, 'utf-8');
    const signatureBytes = Buffer.from(signature, 'base64');

    const isValid = verify(null, payloadBytes, publicKey, signatureBytes);

    if (!isValid) {
      return communityFallback('License signature verification failed — license may be tampered');
    }
  } catch (err) {
    return communityFallback(`Signature verification error: ${err instanceof Error ? err.message : String(err)}`);
  }

  // 7. Expiration check
  const expMs = Date.parse(payload.expiresAt);
  if (!Number.isFinite(expMs)) return communityFallback('Invalid expiresAt');
  
  const expiresAt = new Date(expMs);
  const now = new Date();
  const daysUntilExpiry = Math.ceil((expiresAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));

  if (expiresAt.getTime() < now.getTime()) {
    return communityFallback(`License expired on ${payload.expiresAt} (${Math.abs(daysUntilExpiry)} days ago)`);
  }

  // 8. Resolve features — SECURITY (MED-07): validate against tier allowlist
  const tierAllowed = TIER_FEATURES[payload.tier];
  const features: LicenseFeature[] = payload.features.length > 0
    ? payload.features.filter(f => tierAllowed.includes(f))
    : [...tierAllowed];

  // 9. Resolve limits — clamp overrides to tier ceilings
  const tierLimits = TIER_LIMITS[payload.tier];
  
  // Helper to clamp values. If tier default is -1 (unlimited), accept any positive override or -1.
  // Otherwise, take the minimum of the requested value and the tier default.
  const clampLimit = (requested: number | undefined, ceiling: number) => {
    if (requested === undefined || requested === null) return ceiling;
    if (ceiling === -1) return requested; // Unlimited tier allows any override
    if (requested === -1) return ceiling; // Cannot ask for unlimited if tier has a limit
    return Math.min(requested, ceiling);
  };

  const limits: TierLimits = {
    maxServices: clampLimit(payload.maxServices, tierLimits.maxServices),
    maxEventsPerDay: clampLimit(payload.maxEventsPerDay, tierLimits.maxEventsPerDay),
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
 *   1. ERGENEKON_LICENSE_KEY env var (inline JSON)
 *   2. ERGENEKON_LICENSE env var (file path)
 *   3. .ergenekon-license.json in current directory
 *   4. ergenekon-license.json in current directory
 *   5. ~/.ergenekon-license.json in home directory
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
        // SECURITY: Size cap prevents OOM on hostile license files (L3)
        const stat = statSync(resolved);
        if (stat.size > MAX_LICENSE_FILE_BYTES) {
          return communityFallback(`License file too large: ${stat.size} bytes (max ${MAX_LICENSE_FILE_BYTES})`);
        }
        const content = readFileSync(resolved, 'utf-8');
        return validateLicense(content);
      }
      return communityFallback(`License file not found at ERGENEKON_LICENSE path: ${envPath}`);
    } catch (err) {
      return communityFallback(`Error reading license file: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  // 3. Search standard paths
  for (const searchPath of LICENSE_FILE_SEARCH_PATHS) {
    try {
      const resolved = resolve(searchPath);
      if (existsSync(resolved)) {
        const stat = statSync(resolved);
        if (stat.size > MAX_LICENSE_FILE_BYTES) continue;
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
