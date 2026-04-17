// ============================================================================
// ERGENEKON COLLECTOR — Durable Writer
//
// Crash-safe file writes using the write-rename-fsync dance:
//   1. Write to a temporary file
//   2. fsync the file (data flushed to disk)
//   3. Rename to final path (atomic on POSIX)
//   4. fsync the directory (rename persisted)
//
// This guarantees that after durableWrite() resolves, the file is
// durable even if the process crashes immediately after.
//
// INVARIANT: A file is either fully written or doesn't exist.
//            Partial writes are impossible.
// ============================================================================

import { open, rename, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';

/**
 * Write data to a file durably.
 * After this function resolves, the file is on disk even if the process crashes.
 */
export async function durableWrite(path: string, data: string | Buffer): Promise<void> {
  const dir = dirname(path);
  const tmp = `${dir}/.tmp-${randomUUID()}.json`;

  // Ensure directory exists
  await mkdir(dir, { recursive: true });

  // Step 1: Write to temp file
  const fh = await open(tmp, 'wx', 0o600);
  try {
    await fh.writeFile(data);
    // Step 2: fsync the file — data is now on disk
    await fh.sync();
  } finally {
    await fh.close();
  }

  // Step 3: Atomic rename (on POSIX, rename is atomic)
  await rename(tmp, path);

  // Step 4: fsync the directory — the rename is now durable
  // SECURITY (HIGH-29): Windows does not support directory fsync (EINVAL/EPERM)
  try {
    const dfh = await open(dir, 'r');
    try {
      await dfh.sync();
    } finally {
      await dfh.close();
    }
  } catch (err: unknown) {
    // Gracefully degrade on Windows where directory fsync is not supported
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== 'EINVAL' && code !== 'EPERM' && code !== 'EACCES') {
      throw err;
    }
  }
}
