// ============================================================================
// ERGENEKON LICENSE SERVER — Main Entry Point
//
// Standalone server that handles:
//   1. Stripe Checkout session creation
//   2. Stripe webhook processing (payment.succeeded)
//   3. Ed25519 license key generation
//   4. License key delivery (JSON response + optional email)
//
// Deploy: Docker or any Node.js host
// Env: See .env.example for required variables
// ============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { handleStripeWebhook } from './stripe-webhook.js';
import { handleCreateCheckout } from './checkout.js';
import { generateLicenseForCustomer, formatLicenseJSON, type LicenseRequest } from './license-gen.js';
import { sendLicenseEmail } from './email.js';

const PORT = parseInt(process.env.LICENSE_SERVER_PORT ?? '4400', 10);

// Track free registrations to prevent abuse (in-memory, reset on restart)
const freeRegistrations = new Map<string, { count: number; lastAt: number }>();
const MAX_FREE_PER_EMAIL = 3; // max 3 registrations per email
const RATE_LIMIT_TTL = 60 * 60 * 1000; // 1 hour TTL
const MAX_MAP_SIZE = 10_000; // Hard cap to prevent OOM

// Periodic cleanup: evict expired entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of freeRegistrations) {
    if (now - val.lastAt > RATE_LIMIT_TTL) freeRegistrations.delete(key);
  }
}, 5 * 60 * 1000);

// Normalize email: strip +tags and Gmail dots
function normalizeEmail(email: string): string {
  let [local, domain] = email.split('@');
  local = local.split('+')[0];
  if (['gmail.com', 'googlemail.com'].includes(domain)) {
    local = local.replace(/\./g, '');
  }
  return `${local}@${domain}`;
}

// ── Load env from .env file if present ──────────────────────────
try {
  const { readFileSync } = await import('node:fs');
  const { resolve, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const envPath = resolve(__dirname, '..', '.env');
  const envContent = readFileSync(envPath, 'utf-8');
  for (const line of envContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Handle escaped newlines in PEM keys
    value = value.replace(/\\n/g, '\n');
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch { /* .env not found, use env vars directly */ }

// ── Helper: Read request body ───────────────────────────────────
async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

// ── Helper: JSON response ───────────────────────────────────────
function json(res: ServerResponse, status: number, data: unknown) {
  const allowedOrigins = ['https://ergenekon.dev', 'http://localhost:3000', 'http://localhost:5500'];
  const origin = (res as any).req?.headers?.origin || '*';
  const corsOrigin = allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': corsOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, stripe-signature, x-admin-key',
  });
  res.end(JSON.stringify(data));
}

// ── Server ──────────────────────────────────────────────────────
const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const path = url.pathname;

  // CORS preflight
  if (req.method === 'OPTIONS') {
    json(res, 204, null);
    return;
  }

  try {
    // ── POST /api/checkout — Create Stripe Checkout Session ─────
    if (req.method === 'POST' && path === '/api/checkout') {
      const body = await readBody(req);
      const data = JSON.parse(body.toString('utf-8'));
      const result = await handleCreateCheckout(data);
      json(res, 200, result);
      return;
    }

    // ── POST /api/webhook — Stripe Webhook Handler ──────────────
    if (req.method === 'POST' && path === '/api/webhook') {
      const body = await readBody(req);
      const sig = req.headers['stripe-signature'] as string;
      const result = await handleStripeWebhook(body, sig);
      json(res, 200, result);
      return;
    }

    // ── POST /api/register-free — Launch Period Free License ──────
    // No payment needed — generates a Pro license and emails it.
    // Active only during the free launch period.
    if (req.method === 'POST' && path === '/api/register-free') {
      const body = await readBody(req);
      let data: { email?: string; name?: string };
      try {
        data = JSON.parse(body.toString('utf-8'));
      } catch {
        json(res, 400, { error: 'Invalid JSON body' });
        return;
      }

      const email = data.email?.trim().toLowerCase();
      const name = data.name?.trim() || email?.split('@')[0] || 'User';

      // Validate email
      if (!email || !email.includes('@') || !email.includes('.')) {
        json(res, 400, { error: 'Valid email address is required' });
        return;
      }

      // Rate limit per email (normalized to prevent +tag bypass)
      const rateLimitKey = normalizeEmail(email);
      
      // Hard cap: prevent OOM from script abuse
      if (freeRegistrations.size >= MAX_MAP_SIZE && !freeRegistrations.has(rateLimitKey)) {
        json(res, 503, { error: 'Service temporarily unavailable. Please try again later.' });
        return;
      }
      
      const reg = freeRegistrations.get(rateLimitKey);
      if (reg && reg.count >= MAX_FREE_PER_EMAIL) {
        json(res, 429, { error: 'License already sent to this email. Check your inbox (and spam folder).' });
        return;
      }

      // Log without full PII (GDPR safe)
      const maskedEmail = email.slice(0, 3) + '***@' + email.split('@')[1];
      console.log(`[FREE] Generating free Pro license for: ${maskedEmail}`);

      try {
        const license = generateLicenseForCustomer({
          customerId: `free_${Date.now().toString(36)}`,
          customerEmail: email,
          customerName: name,
          tier: 'pro',
          durationDays: 365,
        });

        const licenseJSON = formatLicenseJSON(license);

        // Send via email
        const emailSent = await sendLicenseEmail({
          to: email,
          customerName: name,
          tier: 'pro',
          licenseId: license.payload.licenseId,
          licenseJSON,
        });

        // Track registration (using normalized key)
        const existing = freeRegistrations.get(rateLimitKey) || { count: 0, lastAt: 0 };
        freeRegistrations.set(rateLimitKey, { count: existing.count + 1, lastAt: Date.now() });

        console.log(`[FREE] ✅ License generated: ${license.payload.licenseId} → ${maskedEmail} (email: ${emailSent ? 'sent' : 'failed'})`);

        json(res, 200, {
          success: true,
          message: emailSent
            ? 'License sent to your email! Check your inbox.'
            : 'License generated. Email delivery pending.',
          licenseId: license.payload.licenseId,
          tier: 'pro',
          expiresAt: license.payload.expiresAt,
          // Include license in response as well (so user can download directly)
          license: license,
        });
      } catch (err) {
        console.error('[FREE] License generation failed:', err);
        json(res, 500, { error: 'Failed to generate license. Please try again.' });
      }
      return;
    }

    // ── POST /api/generate-license — Direct License Generation ──
    // (For manual issuance / admin use)
    if (req.method === 'POST' && path === '/api/generate-license') {
      // SECURITY: Fail-closed — if ADMIN_API_KEY is not configured, reject everything
      const configuredKey = process.env.ADMIN_API_KEY;
      if (!configuredKey) {
        console.error('[SECURITY] /api/generate-license called but ADMIN_API_KEY is not configured. Rejecting.');
        json(res, 503, { error: 'Admin endpoint not configured' });
        return;
      }

      const adminKey = (req.headers['x-admin-key'] as string) || '';
      // Timing-safe comparison to prevent timing attacks
      const keyBuffer = Buffer.from(adminKey);
      const configBuffer = Buffer.from(configuredKey);
      const isValid = keyBuffer.length === configBuffer.length &&
        (await import('node:crypto')).then(c => c.timingSafeEqual(keyBuffer, configBuffer)).catch(() => false);

      if (!await isValid) {
        console.warn(`[SECURITY] Unauthorized /api/generate-license attempt from ${req.socket.remoteAddress}`);
        json(res, 401, { error: 'Unauthorized' });
        return;
      }

      const body = await readBody(req);
      const data: LicenseRequest = JSON.parse(body.toString('utf-8'));
      const license = generateLicenseForCustomer(data);
      json(res, 200, { success: true, license });
      return;
    }

    // ── GET /health ─────────────────────────────────────────────
    if (req.method === 'GET' && path === '/health') {
      json(res, 200, {
        status: 'ok',
        service: 'ergenekon-license-server',
        version: '0.1.0',
        stripe: !!process.env.STRIPE_SECRET_KEY,
        signingKey: !!process.env.ERGENEKON_SIGNING_KEY,
      });
      return;
    }

    // ── 404 ─────────────────────────────────────────────────────
    json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('[LICENSE SERVER] Error:', err);
    json(res, 500, { error: 'Internal server error' });
  }
});

server.listen(PORT, () => {
  const hasStripe = !!process.env.STRIPE_SECRET_KEY;
  const hasKey = !!process.env.ERGENEKON_SIGNING_KEY;
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          ERGENEKON — License Generation Server                 ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║   Server:     http://localhost:${String(PORT).padEnd(30)}║
║   Stripe:     ${(hasStripe ? '✅ Connected' : '❌ Not configured').padEnd(44)}║
║   Signing:    ${(hasKey ? '✅ Ed25519 key loaded' : '❌ No signing key').padEnd(44)}║
║                                                              ║
║   Endpoints:                                                 ║
║     POST /api/register-free   — Free launch license          ║
║     POST /api/checkout          — Create Stripe session      ║
║     POST /api/webhook           — Stripe webhook             ║
║     POST /api/generate-license  — Manual license gen         ║
║     GET  /health                — Health check               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
