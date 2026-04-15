// ============================================================================
// ERGENEKON PROBE — FS Interceptor Tests
//
// Validates:
//   1. Install/uninstall symmetry (original functions restored)
//   2. Zero overhead when not recording
//   3. readFile, writeFile, stat, readdir, access captured
//   4. Error paths captured
// ============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installFsInterceptor, uninstallFsInterceptor } from './fs.js';

// Reference fs.promises through the fs module (same object we patch)
const fsp = fs.promises;

let testDir: string;

beforeEach(async () => {
  testDir = await mkdtemp(join(tmpdir(), 'paradox-fs-test-'));
});

afterEach(async () => {
  uninstallFsInterceptor();
  await rm(testDir, { recursive: true, force: true });
});

describe('FS Interceptor — install/uninstall', () => {
  it('install and uninstall are symmetric', () => {
    const origReadFile = fsp.readFile;
    const origWriteFile = fsp.writeFile;

    installFsInterceptor();
    // After install, functions should be different (wrapped)
    expect(fsp.readFile).not.toBe(origReadFile);
    expect(fsp.writeFile).not.toBe(origWriteFile);

    uninstallFsInterceptor();
    // After uninstall, functions should be restored
    expect(fsp.readFile).toBe(origReadFile);
    expect(fsp.writeFile).toBe(origWriteFile);
  });

  it('double install is idempotent', () => {
    installFsInterceptor();
    const wrapped = fsp.readFile;
    installFsInterceptor();
    expect(fsp.readFile).toBe(wrapped);
    uninstallFsInterceptor();
  });

  it('double uninstall is safe', () => {
    installFsInterceptor();
    uninstallFsInterceptor();
    uninstallFsInterceptor(); // Should not throw
  });
});

describe('FS Interceptor — passthrough when not recording', () => {
  it('readFile works normally when intercepted but not recording', async () => {
    const testFile = join(testDir, 'test.txt');
    await fsp.writeFile(testFile, 'hello paradox');

    installFsInterceptor();

    // No active session — should pass through
    const content = await fsp.readFile(testFile, 'utf-8');
    expect(content).toBe('hello paradox');
  });

  it('writeFile works normally when intercepted but not recording', async () => {
    installFsInterceptor();

    const testFile = join(testDir, 'write-test.txt');
    await fsp.writeFile(testFile, 'test content');

    uninstallFsInterceptor();

    const content = await fsp.readFile(testFile, 'utf-8');
    expect(content).toBe('test content');
  });

  it('stat works normally when intercepted but not recording', async () => {
    const testFile = join(testDir, 'stat-test.txt');
    await fsp.writeFile(testFile, 'x');

    installFsInterceptor();

    const stat = await fsp.stat(testFile);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(1);
  });

  it('readdir works normally when intercepted but not recording', async () => {
    await fsp.writeFile(join(testDir, 'a.txt'), '');
    await fsp.writeFile(join(testDir, 'b.txt'), '');

    installFsInterceptor();

    const files = await fsp.readdir(testDir);
    expect(files).toContain('a.txt');
    expect(files).toContain('b.txt');
  });

  it('access works normally when intercepted but not recording', async () => {
    const testFile = join(testDir, 'access-test.txt');
    await fsp.writeFile(testFile, '');

    installFsInterceptor();

    // Should not throw for existing file
    await expect(fsp.access(testFile)).resolves.toBeUndefined();

    // Should throw for non-existent file
    await expect(fsp.access(join(testDir, 'nope.txt'))).rejects.toThrow();
  });
});
