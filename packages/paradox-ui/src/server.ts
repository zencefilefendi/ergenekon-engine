// ============================================================================
// PARADOX UI — Embedded Web Server
//
// Serves the time-travel debugger UI and proxies API calls to the collector.
// Self-contained: no build step, no bundler, just run it.
//
// Run: npx tsx packages/paradox-ui/src/server.ts
// ============================================================================

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const UI_PORT = parseInt(process.env['PARADOX_UI_PORT'] ?? '3001', 10);
const COLLECTOR_URL = process.env['PARADOX_COLLECTOR_URL'] ?? 'http://localhost:4380';

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
  let filePath = url.pathname === '/' ? '/index.html' : url.pathname;
  const fullPath = join(__dirname, 'public', filePath);
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
║             PARADOX — Time-Travel Debugger UI                ║
╠══════════════════════════════════════════════════════════════╣
║                                                              ║
║   UI:        http://localhost:${UI_PORT}                          ║
║   Collector: ${COLLECTOR_URL.padEnd(44)}║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝
`);
});
