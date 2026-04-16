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

// ── Security Constants ─────────────────────────────────────
const MAX_PER_EMAIL = 3;
const MAX_BODY_SIZE = 2048; // 2KB max request body
const ALLOWED_ORIGINS = [
  'https://ergenekon.dev',
  'https://www.ergenekon.dev',
  'http://localhost:3000',
  'http://localhost:5173',
];

// ── Rate Limiting (in-memory, resets on cold start) ────────
const registrations = new Map();
// Global rate limit: max 30 requests per minute across all IPs
let globalRequestCount = 0;
let globalResetTime = Date.now() + 60000;
const MAX_GLOBAL_RPM = 30;

// ── Input Sanitization ─────────────────────────────────────
function sanitizeEmail(raw) {
  if (!raw || typeof raw !== 'string') return null;
  const email = raw.trim().toLowerCase().slice(0, 254); // RFC 5321 max

  // Strict email validation
  const emailRegex = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/;
  if (!emailRegex.test(email)) return null;

  // Block disposable email providers
  const disposable = ['tempmail', 'throwaway', 'guerrillamail', 'yopmail', 'mailinator', 'trashmail', 'fakeinbox'];
  const domain = email.split('@')[1];
  if (disposable.some(d => domain.includes(d))) return null;

  return email;
}

function sanitizeName(raw) {
  if (!raw || typeof raw !== 'string') return 'User';
  // Strip HTML/script tags and limit to 100 chars
  return raw.replace(/<[^>]*>/g, '').replace(/[^\p{L}\p{N}\s._\-]/gu, '').trim().slice(0, 100) || 'User';
}

// ── License Generator ──────────────────────────────────────
function generateLicense(email, name, tier) {
  const privateKeyPem = process.env.ERGENEKON_SIGNING_KEY;
  if (!privateKeyPem) throw new Error('Signing key not configured');

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 3 months free trial
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
    // Canary: unique fingerprint derived from registration context
    // If this license appears on a forum/Pastebin, we can trace it back
    _fp: Buffer.from(`${email}:${now.getTime()}:${Math.random()}`).toString('base64url').slice(0, 16),
  };

  const privateKey = createPrivateKey(privateKeyPem);
  const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf-8');
  const signature = sign(null, payloadBytes, privateKey);

  return { payload, signature: signature.toString('base64') };
}

// ── API Handler ────────────────────────────────────────────
export default async function handler(req, res) {
  // ── CORS (restricted to our domains) ─────────────────────
  const origin = req.headers?.origin || '';
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Vary', 'Origin');

  // ── Security Headers ─────────────────────────────────────
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ── Body size check ──────────────────────────────────────
    const bodyStr = JSON.stringify(req.body || {});
    if (bodyStr.length > MAX_BODY_SIZE) {
      return res.status(413).json({ error: 'Request too large' });
    }

    // ── Global rate limit ────────────────────────────────────
    if (Date.now() > globalResetTime) {
      globalRequestCount = 0;
      globalResetTime = Date.now() + 60000;
    }
    globalRequestCount++;
    if (globalRequestCount > MAX_GLOBAL_RPM) {
      return res.status(429).json({ error: 'Too many requests. Please try again later.' });
    }

    // ── Honeypot bot trap ────────────────────────────────────
    // The 'website' field is hidden in the form — real users send ''
    // Bots auto-fill it → instant reject (silent, returns success to confuse bot)
    if (req.body?.website) {
      console.warn(JSON.stringify({ event: 'honeypot_triggered', requestId }));
      await timingSafeDelay(requestStart, 300);
      return res.status(200).json({
        success: true,
        message: 'License generated!',
        licenseId: 'lic_' + Date.now().toString(36),
        tier: 'pro',
        expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
        license: { payload: {}, signature: '' },
      });
    }

    // ── Input validation ─────────────────────────────────────
    const { email, name } = req.body || {};
    const cleanEmail = sanitizeEmail(email);
    if (!cleanEmail) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    const cleanName = sanitizeName(name || cleanEmail.split('@')[0]);

    // ── Per-email rate limit ─────────────────────────────────
    const reg = registrations.get(cleanEmail);
    if (reg && reg.count >= MAX_PER_EMAIL) {
      // Don't reveal if email exists (timing-safe)
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    // ── Tier validation (only allow pro/enterprise) ──────────
    const requestedTier = req.body?.tier;
    const tier = requestedTier === 'enterprise' ? 'enterprise' : 'pro';

    // ── Generate license ─────────────────────────────────────
    const license = generateLicense(cleanEmail, cleanName, tier);

    // ── Track registration ───────────────────────────────────
    const existing = registrations.get(cleanEmail) || { count: 0 };
    registrations.set(cleanEmail, { count: existing.count + 1, lastAt: Date.now() });

    // ── Log (no PII in production logs) ──────────────────────
    console.log(`[REGISTER] ${license.payload.licenseId} tier=${tier}`);

    return res.status(200).json({
      success: true,
      message: 'License generated! Download starting...',
      licenseId: license.payload.licenseId,
      tier,
      expiresAt: license.payload.expiresAt,
      license,
    });
  } catch (err) {
    console.error('[REGISTER] Error:', err.message);
    // Never expose internal error details to client
    return res.status(500).json({ error: 'Internal server error. Please try again.' });
  }
}
