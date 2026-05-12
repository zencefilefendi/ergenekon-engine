// ============================================================================
// ERGENEKON UI — Embedded Web Server
//
// Serves the time-travel debugger UI and proxies API calls to the collector.
// Self-contained: no build step, no bundler, just run it.
//
// License-aware: displays tier status and shows upgrade prompts for Community.
//
// Run: npx tsx packages/ergenekon-ui/src/server.ts
// ============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname, resolve, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLicense, getTierDisplay } from '@ergenekon/core';
import { randomBytes } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

const UI_PORT = parseInt(process.env['ERGENEKON_UI_PORT'] ?? '3001', 10);
const COLLECTOR_URL = process.env['ERGENEKON_COLLECTOR_URL'] ?? 'http://localhost:4380';

// Load license for tier display
const license = loadLicense();
const tier = license.tier;
const tierDisplay = getTierDisplay(tier);

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

// Generate a random CSRF token at startup (since this is a single-user local tool)
const CSRF_TOKEN = randomBytes(32).toString('hex');

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://localhost:${UI_PORT}`);

  // SECURITY (HIGH-13): Host header validation — reject DNS rebinding
  const host = req.headers.host || '';
  const hostName = host.replace(/^\[|\]$/g, '').split(':')[0]; // handle IPv6 [::1]:3000
  const allowedHosts = ['localhost', '127.0.0.1', '::1']; // Removed 0.0.0.0
  if (!allowedHosts.includes(hostName)) {
    res.writeHead(403, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Forbidden: invalid Host header' }));
    return;
  }

  // SECURITY (M-08): Strict CORS
  let corsOrigin = '';
  const origin = req.headers.origin;
  if (origin && process.env['NODE_ENV'] !== 'production') {
     // Allow local dev servers in non-prod
     const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://localhost:5173', 'http://127.0.0.1:3000'];
     if (ALLOWED_ORIGINS.includes(origin)) corsOrigin = origin;
  }
  
  res.setHeader('Vary', 'Origin');
  if (corsOrigin) {
    res.setHeader('Access-Control-Allow-Origin', corsOrigin);
  }

  // ── Inject license info endpoint (local, no collector needed) ──
  if (url.pathname === '/api/v1/ui-license') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'X-CSRF-Token': CSRF_TOKEN, // Pass CSRF token to frontend on initial load
    });
    res.end(JSON.stringify({
      tier: license.tier,
      tierDisplay,
      valid: license.valid,
      features: license.features,
      limits: license.limits,
      daysUntilExpiry: license.daysUntilExpiry,
      // SECURITY (HIGH-06): Don't leak customerName to unauthenticated callers
    }));
    return;
  }

  // Proxy API calls to collector
  // SECURITY (HIGH-22): Validate path against strict allowlist to prevent SSRF
  const API_PATH_RE = /^\/api\/v1\/(sessions|traces|stats|license)(\/[a-zA-Z0-9_-]{1,128})?$/;
  if (url.pathname.startsWith('/api/')) {
    if (!API_PATH_RE.test(url.pathname)) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid API path' }));
      return;
    }

    // SECURITY (H-11): CSRF confused deputy protection. Validate origin/Sec-Fetch-Site and CSRF token for mutating requests.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
       const fetchSite = req.headers['sec-fetch-site'];
       if (fetchSite && fetchSite !== 'same-origin') {
         res.writeHead(403, { 'Content-Type': 'application/json' });
         res.end(JSON.stringify({ error: 'Forbidden: Cross-site request' }));
         return;
       }
       const clientCsrfToken = req.headers['x-csrf-token'];
       if (!clientCsrfToken || clientCsrfToken !== CSRF_TOKEN) {
         res.writeHead(403, { 'Content-Type': 'application/json' });
         res.end(JSON.stringify({ error: 'Forbidden: Invalid CSRF token' }));
         return;
       }
    }

    try {
      const collectorUrl = `${COLLECTOR_URL}${url.pathname}${url.search}`;
      // SECURITY: Forward collector auth token from UI → Collector
      const proxyHeaders: Record<string, string> = { 'Content-Type': 'application/json' };
      const collectorToken = process.env['ERGENEKON_COLLECTOR_TOKEN'];
      if (collectorToken) {
        proxyHeaders['Authorization'] = `Bearer ${collectorToken}`;
      }
      // SECURITY: 10s timeout prevents slow-loris DoS via compromised collector
      const response = await fetch(collectorUrl, {
        method: req.method,
        headers: proxyHeaders,
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.text();
      // SECURITY: Cap response size — prevent OOM from malicious collector response
      const MAX_PROXY_RESPONSE = 50 * 1024 * 1024; // 50MB
      if (body.length > MAX_PROXY_RESPONSE) {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Collector response too large' }));
        return;
      }
      res.writeHead(response.status, {
        'Content-Type': 'application/json',
      });
      res.end(body);
    } catch (err) {
      // SECURITY: Don't leak internal collector URL in error details
      const safeMessage = err instanceof Error && err.name === 'AbortError'
        ? 'Collector request timed out'
        : 'Collector unreachable';
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: safeMessage }));
    }
    return;
  }

  // Serve static files
  // SECURITY: Prevent path traversal (../../etc/passwd)
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  // Normalize and strip null bytes
  filePath = normalize(filePath).replace(/\0/g, '');
  const publicDir = resolve(__dirname, 'public');
  const fullPath = resolve(publicDir, '.' + filePath);
  
  // Path traversal check (M-07): must stay within public/ (requires trailing slash check)
  if (!fullPath.startsWith(publicDir + '/')) {
    if (fullPath !== publicDir) { // Allow serving publicDir itself as it might resolve to index.html logic
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden');
      return;
    }
  }
  
  // SPA fallback check (M-09): don't fallback dotfiles or certain paths
  if (filePath.startsWith('/.') || filePath.startsWith('/admin')) {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not found');
    return;
  }
  
  const ext = extname(fullPath);
  const contentType = MIME_TYPES[ext] ?? 'text/plain';
  // SECURITY (HIGH-07): Binary file types must NOT be read as UTF-8
  const binaryExts = new Set(['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot']);
  const isBinary = binaryExts.has(ext);

  // SECURITY (HIGH-14): Content-Security-Policy for UI pages
  const securityHeaders: Record<string, string> = {
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  };
  if (ext === '.html') {
    securityHeaders['Content-Security-Policy'] =
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'";
  }

  try {
    const content = isBinary
      ? await readFile(fullPath)           // Buffer for binary
      : await readFile(fullPath, 'utf-8'); // String for text
    res.writeHead(200, securityHeaders);
    res.end(content);
  } catch {
    // SECURITY (HIGH-32): Only SPA-fallback for navigation requests (HTML)
    // Don't serve index.html for missing .js/.css/.png — return 404
    if (ext && ext !== '.html') {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    // SPA fallback for client-side routing
    try {
      const indexContent = await readFile(join(__dirname, 'public', 'index.html'), 'utf-8');
      res.writeHead(200, { ...securityHeaders, 'Content-Type': 'text/html' });
      res.end(indexContent);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  }
});

server.listen(UI_PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════════════════╗
║             ERGENEKON — Time-Travel Debugger UI                ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║   UI:        http://localhost:${UI_PORT}                          ║
║   Collector: ${COLLECTOR_URL.padEnd(44)}║
║   License:   ${tierDisplay.padEnd(44)}║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
});
