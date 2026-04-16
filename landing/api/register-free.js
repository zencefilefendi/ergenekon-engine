import { createPrivateKey, sign } from 'node:crypto';

// ── Feature Lists ──────────────────────────────────────────
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

// ── Rate Limiting (in-memory, resets on cold start) ────────
const registrations = new Map();
const MAX_PER_EMAIL = 3;

// ── License Generator ──────────────────────────────────────
function generateLicense(email, name, tier) {
  const privateKeyPem = process.env.ERGENEKON_SIGNING_KEY;
  if (!privateKeyPem) throw new Error('ERGENEKON_SIGNING_KEY not configured');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);
  const features = tier === 'enterprise' ? ENTERPRISE_FEATURES : PRO_FEATURES;

  const payload = {
    version: 1,
    licenseId: `lic_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
    customerId: `free_${Date.now().toString(36)}`,
    customerEmail: email,
    customerName: name,
    tier,
    maxServices: -1,
    maxEventsPerDay: -1,
    features,
    issuedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };

  const privateKey = createPrivateKey(privateKeyPem);
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8');
  const signature = sign(null, payloadBytes, privateKey);

  return { payload, signature: signature.toString('base64') };
}

// ── API Handler ────────────────────────────────────────────
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email, name } = req.body || {};
    const cleanEmail = email?.trim().toLowerCase();
    const cleanName = name?.trim() || cleanEmail?.split('@')[0] || 'User';

    // Validate
    if (!cleanEmail || !cleanEmail.includes('@') || !cleanEmail.includes('.')) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }

    // Rate limit
    const reg = registrations.get(cleanEmail);
    if (reg && reg.count >= MAX_PER_EMAIL) {
      return res.status(429).json({ error: 'License already sent to this email. Check your inbox (and spam folder).' });
    }

    // Generate license
    const tier = req.body?.tier === 'enterprise' ? 'enterprise' : 'pro';
    const license = generateLicense(cleanEmail, cleanName, tier);

    // Track
    const existing = registrations.get(cleanEmail) || { count: 0 };
    registrations.set(cleanEmail, { count: existing.count + 1, lastAt: Date.now() });

    console.log(`[FREE] ✅ License: ${license.payload.licenseId} → ${cleanEmail} (${tier})`);

    return res.status(200).json({
      success: true,
      message: 'License generated! Download starting...',
      licenseId: license.payload.licenseId,
      tier,
      expiresAt: license.payload.expiresAt,
      license,
    });
  } catch (err) {
    console.error('[FREE] Error:', err);
    return res.status(500).json({ error: 'Failed to generate license. Please try again.' });
  }
}
