// ============================================================================
// ERGENEKON COLLECTOR — Storage Engine (Phase 6 Hardened)
//
// File-based storage with crash-safe guarantees:
//   - durableWrite: write → fsync → rename → dir-fsync
//   - SHA-256 checksum on every file, verified on load
//   - Corrupt files quarantined to sessions/corrupt/
//   - Backwards-compatible with pre-checksum files
//
// INVARIANTS:
//   1. A stored file is either fully written + verified, or doesn't exist
//   2. Corrupt files are NEVER silently skipped — they are quarantined
//   3. getCorruptCount() > 0 means an alert should fire
//
// Future: StorageBackend interface for S3/Postgres (Phase 8)
// ============================================================================

import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rename as fsRename } from 'node:fs/promises';
import { join, resolve, relative } from 'node:path';
import type { RecordingSession } from '@ergenekon/core';
import { durableWrite } from './durable-writer.js';
import { wrapWithChecksum, verifyAndUnwrap, ChecksumError } from './checksum.js';

// ── Security: Session ID validation ──────────────────────────────
// Prevents path traversal attacks (e.g. id="../../package.json")
const SAFE_SESSION_ID = /^[a-zA-Z0-9_\-]{1,128}$/;

function validateSessionId(id: string): void {
  if (!id || typeof id !== 'string') {
    throw new SessionIdError('Session ID is required');
  }
  if (!SAFE_SESSION_ID.test(id)) {
    throw new SessionIdError(`Invalid session ID: contains illegal characters or exceeds 128 chars`);
  }
}

function assertWithinDir(filepath: string, baseDir: string): void {
  const resolved = resolve(filepath);
  const resolvedBase = resolve(baseDir);
  if (!resolved.startsWith(resolvedBase)) {
    throw new SessionIdError(`Path traversal detected: ${filepath}`);
  }
}

export class SessionIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SessionIdError';
  }
}

export class FileStorage {
  private readonly baseDir: string;
  private readonly sessionsDir: string;
  private readonly indexDir: string;
  private readonly corruptDir: string;

  // In-memory index for fast lookups
  private traceIndex = new Map<string, string[]>(); // traceId → sessionIds
  private sessionIndex = new Map<string, string>();  // sessionId → filename

  // Corruption tracking
  private _corruptCount = 0;

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.sessionsDir = join(baseDir, 'sessions');
    this.indexDir = join(baseDir, 'index');
    this.corruptDir = join(baseDir, 'sessions', 'corrupt');
  }

  /** Initialize storage directories */
  async init(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    await mkdir(this.indexDir, { recursive: true });
    await mkdir(this.corruptDir, { recursive: true });
    await this.rebuildIndex();
  }

  /**
   * Store a recording session durably.
   *
   * Uses the write-rename-fsync dance:
   *   1. Serialize session + compute SHA-256 checksum
   *   2. Write to temp file, fsync
   *   3. Atomic rename to final path
   *   4. fsync directory
   */
  async store(session: RecordingSession): Promise<string> {
    // SECURITY: Validate session ID to prevent path traversal
    validateSessionId(session.id);
    const filename = `${session.id}.json`;
    const filepath = join(this.sessionsDir, filename);
    assertWithinDir(filepath, this.sessionsDir);

    // Wrap with checksum for integrity verification on load
    const content = wrapWithChecksum(session);
    await durableWrite(filepath, content);

    // Update in-memory index
    this.sessionIndex.set(session.id, filename);
    const traceIds = this.traceIndex.get(session.traceId) ?? [];
    traceIds.push(session.id);
    this.traceIndex.set(session.traceId, traceIds);

    return session.id;
  }

  /**
   * Load a recording session by ID.
   * Verifies checksum on load. Quarantines corrupt files.
   */
  async load(sessionId: string): Promise<RecordingSession | null> {
    const filename = this.sessionIndex.get(sessionId);
    if (!filename) return null;

    const filepath = join(this.sessionsDir, filename);

    try {
      const data = await readFile(filepath, 'utf-8');
      return verifyAndUnwrap<RecordingSession>(data);
    } catch (err) {
      if (err instanceof ChecksumError) {
        // Quarantine the corrupt file
        await this.quarantine(filename, err.message);
        this.sessionIndex.delete(sessionId);
        return null;
      }
      return null; // file doesn't exist or unreadable
    }
  }

  /** Find all sessions for a given trace ID */
  async findByTraceId(traceId: string): Promise<RecordingSession[]> {
    const sessionIds = this.traceIndex.get(traceId) ?? [];
    const sessions: RecordingSession[] = [];

    for (const id of sessionIds) {
      const session = await this.load(id);
      if (session) sessions.push(session);
    }

    return sessions;
  }

  /** List all stored sessions (metadata only, no events) */
  async listSessions(): Promise<Array<{
    id: string;
    traceId: string;
    serviceName: string;
    startedAt: number;
    endedAt: number;
    eventCount: number;
    hasError: boolean;
  }>> {
    const sessions: Array<{
      id: string;
      traceId: string;
      serviceName: string;
      startedAt: number;
      endedAt: number;
      eventCount: number;
      hasError: boolean;
    }> = [];

    for (const sessionId of this.sessionIndex.keys()) {
      const session = await this.load(sessionId);
      if (session) {
        sessions.push({
          id: session.id,
          traceId: session.traceId,
          serviceName: session.serviceName,
          startedAt: session.startedAt,
          endedAt: session.endedAt,
          eventCount: session.events.length,
          hasError: session.metadata.hasError,
        });
      }
    }

    return sessions.sort((a, b) => b.startedAt - a.startedAt);
  }

  /** Generate a content hash for deduplication (future CAS) */
  contentHash(data: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(data))
      .digest('hex')
      .slice(0, 16);
  }

  /** How many corrupt files have been quarantined */
  getCorruptCount(): number {
    return this._corruptCount;
  }

  /** Move a corrupt file to the quarantine directory */
  private async quarantine(filename: string, reason: string): Promise<void> {
    try {
      const src = join(this.sessionsDir, filename);
      const dst = join(this.corruptDir, `${Date.now()}-${filename}`);
      await fsRename(src, dst);
      this._corruptCount++;
      console.error(`[ERGENEKON STORAGE] Quarantined corrupt file: ${filename} — ${reason}`);
    } catch {
      // Best effort — if we can't move it, at least we didn't serve it
      this._corruptCount++;
    }
  }

  /**
   * Rebuild in-memory index from disk.
   * Verifies checksum on each file. Quarantines corrupt ones.
   */
  private async rebuildIndex(): Promise<void> {
    this.sessionIndex.clear();
    this.traceIndex.clear();
    this._corruptCount = 0;

    try {
      const files = await readdir(this.sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await readFile(join(this.sessionsDir, file), 'utf-8');
          const session = verifyAndUnwrap<RecordingSession>(data);
          this.sessionIndex.set(session.id, file);
          const traceIds = this.traceIndex.get(session.traceId) ?? [];
          traceIds.push(session.id);
          this.traceIndex.set(session.traceId, traceIds);
        } catch (err) {
          if (err instanceof ChecksumError) {
            await this.quarantine(file, err.message);
          }
          // Other errors (file read failure) — skip silently
        }
      }
    } catch {
      // No sessions directory yet
    }
  }
}
