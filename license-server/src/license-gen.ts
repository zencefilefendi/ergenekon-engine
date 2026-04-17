// ============================================================================
// ERGENEKON LICENSE SERVER — License Generator
//
// Generates Ed25519-signed license tokens for paying customers.
// Uses the private key from ERGENEKON_SIGNING_KEY environment variable.
// ============================================================================

import { createPrivateKey, sign } from 'node:crypto';

export interface LicenseRequest {
  customerId: string;
  customerEmail: string;
  customerName: string;
  tier: 'pro' | 'enterprise';
  durationDays?: number;
}

interface LicensePayload {
  version: 1;
  licenseId: string;
  customerId: string;
  customerEmail: string;
  customerName: string;
  tier: string;
  maxServices: number;
  maxEventsPerDay: number;
  features: string[];
  issuedAt: string;
  expiresAt: string;
}

interface SignedLicense {
  payload: LicensePayload;
  signature: string;
}

// ── Feature Lists ───────────────────────────────────────────────

const PRO_FEATURES = [
  'single_service_replay', 'basic_cli',
  'distributed_replay', 'smart_sampling', 'deep_redaction',
  'prdx_export', 'time_travel_ui',
  'fs_interceptor', 'dns_interceptor', 'database_interceptor',
  'advanced_cli',
];

const ENTERPRISE_FEATURES = [
  ...PRO_FEATURES,
  'unlimited_retention', 'sso_saml', 'rbac',
  'on_premise', 'audit_log', 'custom_integrations', 'sla_guarantee',
];

// ── ULID Generator (simple) ─────────────────────────────────────

function generateId(): string {
  const time = Date.now().toString(36);
  // SECURITY: Use crypto.randomBytes instead of Math.random (M2)
  // Math.random is NOT cryptographically secure and can be predicted
  const { randomBytes } = require('node:crypto');
  const rand = randomBytes(8).toString('base64url');
  return `lic_${time}${rand}`;
}

// ── License Generator ───────────────────────────────────────────

export function generateLicenseForCustomer(request: LicenseRequest): SignedLicense {
  const privateKeyPem = process.env.ERGENEKON_SIGNING_KEY;
  if (!privateKeyPem) {
    throw new Error('ERGENEKON_SIGNING_KEY not set');
  }

  const now = new Date();
  const durationDays = request.durationDays ?? 365;
  const expiresAt = new Date(now.getTime() + durationDays * 24 * 60 * 60 * 1000);

  const features = request.tier === 'enterprise' ? ENTERPRISE_FEATURES : PRO_FEATURES;

  const payload: LicensePayload = {
    version: 1,
    licenseId: generateId(),
    customerId: request.customerId,
    customerEmail: request.customerEmail,
    customerName: request.customerName,
    tier: request.tier,
    maxServices: -1,
    maxEventsPerDay: -1,
    features,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const privateKey = createPrivateKey(privateKeyPem);
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8');
  const signature = sign(null, payloadBytes, privateKey);

  return {
    payload,
    signature: signature.toString('base64'),
  };
}

/**
 * Format a license as a pretty-printed JSON string
 * ready to be saved as .ergenekon-license.json
 */
export function formatLicenseJSON(license: SignedLicense): string {
  return JSON.stringify(license, null, 2);
}
