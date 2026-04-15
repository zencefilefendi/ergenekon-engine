// ============================================================================
// ERGENEKON ENGINE — License Generator (SERVER-ONLY)
//
// ⚠️  THIS FILE IS NOT PUBLISHED TO NPM ⚠️
// It is excluded via .npmignore and only runs on the license server.
//
// Generates Ed25519-signed license tokens for paying customers.
// The private key is provided via environment variable ERGENEKON_SIGNING_KEY.
//
// Usage (license server only):
//   import { generateLicense } from './license-generator.js';
//   const signed = generateLicense({
//     customerId: 'cus_stripe_id',
//     customerEmail: 'user@company.com',
//     customerName: 'ACME Corp',
//     tier: 'pro',
//     durationDays: 365,
//   });
//   // → SignedLicense JSON ready to send to customer
// ============================================================================

import { createPrivateKey, sign } from 'node:crypto';
import type { LicenseToken, LicenseTier, LicenseFeature, SignedLicense } from './license-types.js';
import { TIER_FEATURES } from './license-types.js';
import { ulid } from './ulid.js';

// ── Configuration ──────────────────────────────────────────────────

/** Parameters for generating a new license */
export interface LicenseGenerateParams {
  /** Stripe customer ID */
  customerId: string;
  /** Customer email address */
  customerEmail: string;
  /** Customer/organization name */
  customerName: string;
  /** License tier */
  tier: LicenseTier;
  /** License duration in days (default: 365) */
  durationDays?: number;
  /** Override max services (-1 for tier default) */
  maxServices?: number;
  /** Override max events per day (-1 for tier default) */
  maxEventsPerDay?: number;
  /** Explicit feature list (overrides tier defaults) */
  features?: LicenseFeature[];
}

// ── Generator ──────────────────────────────────────────────────────

/**
 * Generate a signed license token.
 *
 * @param params - License parameters
 * @param privateKeyPem - Ed25519 private key in PEM format.
 *                        If not provided, reads from ERGENEKON_SIGNING_KEY env var.
 * @returns SignedLicense — ready to write to .ergenekon-license.json
 * @throws Error if private key is not available
 */
export function generateLicense(
  params: LicenseGenerateParams,
  privateKeyPem?: string,
): SignedLicense {
  // Resolve private key
  const keyPem = privateKeyPem || process.env.ERGENEKON_SIGNING_KEY;
  if (!keyPem) {
    throw new Error(
      'ERGENEKON_SIGNING_KEY environment variable not set. ' +
      'The Ed25519 private key is required to sign licenses.'
    );
  }

  const now = new Date();
  const durationDays = params.durationDays ?? 365;
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  // Build the license payload
  const payload: LicenseToken = {
    version: 1,
    licenseId: `lic_${ulid()}`,
    customerId: params.customerId,
    customerEmail: params.customerEmail,
    customerName: params.customerName,
    tier: params.tier,
    maxServices: params.maxServices ?? -1,
    maxEventsPerDay: params.maxEventsPerDay ?? -1,
    features: params.features ?? [...TIER_FEATURES[params.tier]],
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  // Sign the payload with Ed25519
  const privateKey = createPrivateKey(keyPem);
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8');
  const signature = sign(null, payloadBytes, privateKey);

  return {
    payload,
    signature: signature.toString('base64'),
  };
}

/**
 * Generate a license and return it as a formatted JSON string.
 * Ready to be written to .ergenekon-license.json
 */
export function generateLicenseJSON(
  params: LicenseGenerateParams,
  privateKeyPem?: string,
): string {
  const signed = generateLicense(params, privateKeyPem);
  return JSON.stringify(signed, null, 2);
}
