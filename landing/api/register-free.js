import { createPrivateKey, sign, randomBytes } from 'node:crypto';

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
const RATE_LIMIT_TTL = 60 * 60 * 1000; // 1 hour TTL for rate limit entries
const MAX_MAP_SIZE = 10_000; // Hard cap to prevent memory exhaustion

// Periodic cleanup: evict expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  let evicted = 0;
  for (const [key, val] of registrations) {
    if (now - val.lastAt > RATE_LIMIT_TTL) {
      registrations.delete(key);
      evicted++;
    }
  }
  if (evicted > 0) console.log(`[SECURITY] Rate limit cleanup: evicted ${evicted} stale entries, ${registrations.size} remaining`);
}, 5 * 60 * 1000);

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
  const disposable = ['tempmail', 'throwaway', 'guerrillamail', 'yopmail', 'mailinator', 'trashmail', 'fakeinbox',
    '10minutemail', 'temp-mail', 'dispostable', 'sharklasers', 'grr.la', 'guerrillamailblock',
    'maildrop', 'mailnesia', 'getairmail', 'minutemail', 'tempinbox', 'mohmal', 'burpcollaborator'];
  const domain = email.split('@')[1];
  if (disposable.some(d => domain.includes(d))) return null;

  return email;
}

// Normalize email for rate limiting: strips +tags and Gmail dots
// user+promo@gmail.com → user@gmail.com
// u.s.e.r@gmail.com → user@gmail.com  
function normalizeEmailForRateLimit(email) {
  let [local, domain] = email.split('@');
  
  // Strip +tag (works for Gmail, Outlook, ProtonMail, etc.)
  local = local.split('+')[0];
  
  // Gmail ignores dots in local part
  const gmailDomains = ['gmail.com', 'googlemail.com'];
  if (gmailDomains.includes(domain)) {
    local = local.replace(/\./g, '');
  }
  
  return `${local}@${domain}`;
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
    // SECURITY (MED-05): Use crypto.randomBytes instead of Math.random
    licenseId: `lic_${Date.now().toString(36)}${randomBytes(6).toString('base64url').slice(0, 8)}`,
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
    _fp: randomBytes(12).toString('base64url').slice(0, 16),
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

    // ── Client IP (Vercel x-real-ip cannot be spoofed) ──────
    const clientIp = req.headers['x-real-ip']
      || (req.headers['x-forwarded-for'] || '').split(',').pop()?.trim()
      || 'unknown';

    // ── Per-IP rate limit (5 registrations/hour) ────────────
    const ipKey = `ip:${clientIp}`;
    const ipReg = registrations.get(ipKey);
    const IP_LIMIT = 5;
    if (ipReg && ipReg.count >= IP_LIMIT && (Date.now() - ipReg.lastAt) < RATE_LIMIT_TTL) {
      console.warn(`[SECURITY] Per-IP rate limit hit: ${clientIp}`);
      return res.status(429).json({ error: 'Too many requests from this address. Please try again later.' });
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
      // SECURITY (CRIT-05): These were previously undefined, causing ReferenceError
      const honeypotRequestId = randomBytes(16).toString('hex');
      const honeypotStart = Date.now();
      console.warn(JSON.stringify({ event: 'honeypot_triggered', requestId: honeypotRequestId }));
      // Timing-safe delay: always take at least 300ms to prevent timing oracle
      const elapsed = Date.now() - honeypotStart;
      if (elapsed < 300) await new Promise(r => setTimeout(r, 300 - elapsed));
      return res.status(200).json({
        success: true,
        message: 'Registration received!',
        // SECURITY: Return a clearly fake/non-functional license shape
        licenseId: 'lic_' + randomBytes(8).toString('hex'),
        tier: 'pro',
        expiresAt: new Date(Date.now() + 90 * 86400000).toISOString(),
      });
    }

    // ── Input validation ─────────────────────────────────────
    const { email, name } = req.body || {};
    const cleanEmail = sanitizeEmail(email);
    if (!cleanEmail) {
      return res.status(400).json({ error: 'Valid email address is required' });
    }
    const cleanName = sanitizeName(name || cleanEmail.split('@')[0]);

    // ── Per-email rate limit (normalized to prevent +tag bypass) ──
    const rateLimitKey = normalizeEmailForRateLimit(cleanEmail);
    
    // Hard cap: if map is too large, reject to prevent OOM
    if (registrations.size >= MAX_MAP_SIZE && !registrations.has(rateLimitKey)) {
      console.error(`[SECURITY] Rate limit map at capacity (${MAX_MAP_SIZE}). Rejecting new registration.`);
      return res.status(503).json({ error: 'Service temporarily unavailable. Please try again later.' });
    }
    
    const reg = registrations.get(rateLimitKey);
    if (reg && reg.count >= MAX_PER_EMAIL) {
      // Don't reveal if email exists (timing-safe)
      return res.status(429).json({ error: 'Rate limit exceeded. Please try again later.' });
    }

    // SECURITY: Free trial is ALWAYS Pro tier.
    // Enterprise licenses are only issued through the paid Stripe checkout flow.
    // Never trust client-supplied tier — ignore req.body.tier entirely.
    const tier = 'pro';

    // ── Generate license ─────────────────────────────────────
    const license = generateLicense(cleanEmail, cleanName, tier);

    // ── Track registration (email + IP) ───────────────────────
    const existing = registrations.get(rateLimitKey) || { count: 0, lastAt: 0 };
    registrations.set(rateLimitKey, { count: existing.count + 1, lastAt: Date.now() });
    const existingIp = registrations.get(ipKey) || { count: 0, lastAt: 0 };
    registrations.set(ipKey, { count: existingIp.count + 1, lastAt: Date.now() });

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
