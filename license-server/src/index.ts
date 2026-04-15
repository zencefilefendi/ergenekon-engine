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
import { generateLicenseForCustomer, type LicenseRequest } from './license-gen.js';

const PORT = parseInt(process.env.LICENSE_SERVER_PORT ?? '4400', 10);

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
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, stripe-signature',
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

    // ── POST /api/generate-license — Direct License Generation ──
    // (For manual issuance / admin use)
    if (req.method === 'POST' && path === '/api/generate-license') {
      const body = await readBody(req);
      const data: LicenseRequest = JSON.parse(body.toString('utf-8'));

      // Simple admin auth (replace with proper auth in production)
      const adminKey = req.headers['x-admin-key'];
      if (adminKey !== process.env.ADMIN_API_KEY && process.env.ADMIN_API_KEY) {
        json(res, 401, { error: 'Unauthorized' });
        return;
      }

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
║     POST /api/checkout          — Create Stripe session      ║
║     POST /api/webhook           — Stripe webhook             ║
║     POST /api/generate-license  — Manual license gen         ║
║     GET  /health                — Health check               ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
  `);
});
