// ============================================================================
// ERGENEKON LICENSE SERVER — License Generator
//
// Generates Ed25519-signed license tokens for paying customers.
// Uses the private key from ERGENEKON_SIGNING_KEY environment variable.
// ============================================================================

import { generateLicense, generateLicenseJSON as coreFormatJSON, LicenseGenerateParams } from '@ergenekon/core';

export interface LicenseRequest {
  customerId: string;
  customerEmail: string;
  customerName: string;
  tier: 'pro' | 'enterprise';
  durationDays?: number;
}

export function generateLicenseForCustomer(request: LicenseRequest) {
  const privateKeyPem = process.env.ERGENEKON_SIGNING_KEY;
  if (!privateKeyPem) {
    throw new Error('ERGENEKON_SIGNING_KEY not set');
  }

  const params: LicenseGenerateParams = {
    customerId: request.customerId,
    customerEmail: request.customerEmail,
    customerName: request.customerName,
    tier: request.tier,
    durationDays: request.durationDays,
  };

  return generateLicense(params, privateKeyPem);
}

export function formatLicenseJSON(license: any): string {
  return JSON.stringify(license, null, 2);
}
