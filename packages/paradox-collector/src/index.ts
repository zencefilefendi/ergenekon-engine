// ============================================================================
// ERGENEKON COLLECTOR — Entry Point
// ============================================================================

export { CollectorServer, type CollectorServerConfig } from './server.js';
export { FileStorage } from './storage.js';

// ── CLI: Start collector as standalone server ──────────────────────

const isDirectRun = process.argv[1]?.includes('paradox-collector');

if (isDirectRun) {
  const port = parseInt(process.env['ERGENEKON_PORT'] ?? '4380', 10);
  const storageDir = process.env['ERGENEKON_STORAGE'] ?? '.ergenekon-recordings';

  const { CollectorServer } = await import('./server.js');
  const server = new CollectorServer({ port, storageDir });
  await server.start();

  process.on('SIGINT', async () => {
    console.log('\n[ERGENEKON COLLECTOR] Shutting down...');
    await server.stop();
    process.exit(0);
  });
}
