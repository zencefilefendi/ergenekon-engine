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

const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? '/', `http://localhost:${UI_PORT}`);

  // ── Inject license info endpoint (local, no collector needed) ──
  if (url.pathname === '/api/v1/ui-license') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    });
    res.end(JSON.stringify({
      tier: license.tier,
      tierDisplay,
      valid: license.valid,
      features: license.features,
      limits: license.limits,
      daysUntilExpiry: license.daysUntilExpiry,
      customerName: license.license?.customerName ?? null,
    }));
    return;
  }

  // Proxy API calls to collector
  if (url.pathname.startsWith('/api/')) {
    try {
      const collectorUrl = `${COLLECTOR_URL}${url.pathname}${url.search}`;
      const response = await fetch(collectorUrl, {
        method: req.method,
        headers: { 'Content-Type': 'application/json' },
      });
      const body = await response.text();
      res.writeHead(response.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      });
      res.end(body);
    } catch (err) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Collector unreachable', details: String(err) }));
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
  
  // Path traversal check: must stay within public/
  if (!fullPath.startsWith(publicDir)) {
    res.writeHead(403, { 'Content-Type': 'text/plain' });
    res.end('Forbidden');
    return;
  }
  
  const ext = extname(fullPath);
  const contentType = MIME_TYPES[ext] ?? 'text/plain';

  try {
    const content = await readFile(fullPath, 'utf-8');
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(content);
  } catch {
    // Fallback to index.html for SPA routing
    try {
      const indexContent = await readFile(join(__dirname, 'public', 'index.html'), 'utf-8');
      res.writeHead(200, { 'Content-Type': 'text/html' });
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
