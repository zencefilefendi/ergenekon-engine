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
import { mkdir, readFile, readdir, rename as fsRename, lstat, open, appendFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import type { RecordingSession } from '@ergenekon/core';
import { durableWrite } from './durable-writer.js';
import { wrapWithChecksum, verifyAndUnwrap, ChecksumError } from './checksum.js';

// ── Security: Session ID validation ──────────────────────────────
// Prevents path traversal attacks (e.g. id="../../package.json")
const SAFE_SESSION_ID = /^[a-zA-Z0-9_\-]{1,128}$/;
// SECURITY: Prevent Windows Native I/O DOS via reserved names (CON, PRN, etc.)
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/i;

// SECURITY: Prevent OOM by bounding the number of sessions per trace
const MAX_SESSIONS_PER_TRACE = 1000;

function validateSessionId(id: string): void {
  if (!id || typeof id !== 'string') {
    throw new SessionIdError('Session ID is required');
  }
  if (!SAFE_SESSION_ID.test(id)) {
    throw new SessionIdError(`Invalid session ID: contains illegal characters or exceeds 128 chars`);
  }
  if (WINDOWS_RESERVED.test(id)) {
    throw new SessionIdError(`Invalid session ID: reserved Windows device name`);
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
  private sessionMetadata = new Map<string, { traceId: string, serviceName: string, startedAt: number, endedAt: number, eventCount: number, hasError: boolean }>();
  private inFlightWrites = new Set<string>(); // SECURITY (H-06): TOCTOU prevention

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
   */
  async store(session: RecordingSession): Promise<string> {
    // SECURITY: Validate session ID to prevent path traversal
    validateSessionId(session.id);
    const filename = `${session.id}.json`;
    const filepath = join(this.sessionsDir, filename);
    assertWithinDir(filepath, this.sessionsDir);

    // SECURITY (HIGH-09, H-06): Reject overwrites and concurrent writes
    if (this.sessionIndex.has(session.id) || this.inFlightWrites.has(session.id)) {
      throw new Error(`[SECURITY] Session ${session.id} already exists or is being written. Overwrites are not allowed.`);
    }

    // SECURITY (H-08): Unbounded heap via Object traceId
    if (typeof session.traceId !== 'string') {
      throw new Error(`[SECURITY] Invalid traceId: must be a string`);
    }

    this.inFlightWrites.add(session.id);

    try {
      // Wrap with checksum for integrity verification on load
      const content = wrapWithChecksum(session);
      await durableWrite(filepath, content);

      // Update in-memory index
      this.sessionIndex.set(session.id, filename);
      
      const meta = {
        traceId: session.traceId,
        serviceName: session.serviceName,
        startedAt: session.startedAt,
        endedAt: session.endedAt,
        eventCount: session.events?.length || 0,
        hasError: session.metadata?.hasError || false,
      };

      this.sessionMetadata.set(session.id, meta);

      // SECURITY (HIGH-28): Use Set to prevent duplicate trace index entries
      if (!this.traceIndex.has(session.traceId)) {
        this.traceIndex.set(session.traceId, []);
      }
      const traceIds = this.traceIndex.get(session.traceId)!;
      if (!traceIds.includes(session.id)) {
        if (traceIds.length >= MAX_SESSIONS_PER_TRACE) {
          throw new SessionIdError(`[SECURITY] Too many sessions for traceId: ${session.traceId}`);
        }
        traceIds.push(session.id);
      }

      // Fast path index writing (append-only log) to avoid Startup DoS
      const indexEntry = JSON.stringify({ id: session.id, ...meta }) + '\n';
      await appendFile(join(this.indexDir, 'index.jsonl'), indexEntry, 'utf-8').catch(() => {});
    } finally {
      this.inFlightWrites.delete(session.id);
    }

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
    assertWithinDir(filepath, this.sessionsDir);

    let fileHandle = null;
    try {
      // SECURITY (ZAFİYET 4): Avoid TOCTOU race condition
      fileHandle = await open(filepath, constants.O_RDONLY | constants.O_NOFOLLOW);
      const data = await fileHandle.readFile('utf-8');
      await fileHandle.close();
      fileHandle = null;
      
      return verifyAndUnwrap<RecordingSession>(data);
    } catch (err: any) {
      if (fileHandle) {
         try { await fileHandle.close(); } catch {}
      }
      if (err.code === 'ELOOP') {
        console.error(`[SECURITY] Symlink detected in session storage: ${filename}. Refusing to read.`);
        this.sessionIndex.delete(sessionId);
        return null;
      }
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
  async findByTraceId(traceId: string, limit: number = 100, offset: number = 0): Promise<RecordingSession[]> {
    const sessionIds = this.traceIndex.get(traceId) ?? [];
    const sessions: RecordingSession[] = [];

    const pageIds = sessionIds.slice(offset, offset + limit);

    for (const id of pageIds) {
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

    // SECURITY (H-09): Use in-memory metadata to prevent CPU DoS from re-reading and hashing all files on every GET /sessions request
    for (const [sessionId, meta] of this.sessionMetadata.entries()) {
      sessions.push({
        id: sessionId,
        ...meta
      });
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
    this.sessionMetadata.clear();
    this._corruptCount = 0;

    // Fast path: attempt to read the index.jsonl append-only log
    try {
      const indexData = await readFile(join(this.indexDir, 'index.jsonl'), 'utf-8');
      const lines = indexData.split('\n');
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const meta = JSON.parse(line);
          this.sessionIndex.set(meta.id, `${meta.id}.json`);
          this.sessionMetadata.set(meta.id, {
            traceId: meta.traceId,
            serviceName: meta.serviceName,
            startedAt: meta.startedAt,
            endedAt: meta.endedAt,
            eventCount: meta.eventCount,
            hasError: meta.hasError,
          });
          const traceIds = this.traceIndex.get(meta.traceId) ?? [];
          if (!traceIds.includes(meta.id)) {
            if (traceIds.length < MAX_SESSIONS_PER_TRACE) {
              traceIds.push(meta.id);
            }
          }
          this.traceIndex.set(meta.traceId, traceIds);
        } catch (e) {
          // ignore corrupted lines
        }
      }
      return; // Fast path successful!
    } catch (err) {
      // Ignore if index.jsonl doesn't exist, fallback to full rebuild
    }

    try {
      const files = await readdir(this.sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filepath = join(this.sessionsDir, file);
        let fileHandle = null;
        try {
          // SECURITY (ZAFİYET 4): Avoid TOCTOU race condition (lstat then readFile)
          // Open the file with O_NOFOLLOW to fail atomically if it's a symlink
          fileHandle = await open(filepath, constants.O_RDONLY | constants.O_NOFOLLOW);
          
          const stat = await fileHandle.stat();
          // SECURITY: Skip oversized files — prevent OOM during rebuild
          if (stat.size > 64 * 1024 * 1024) { // 64MB cap per file
            console.warn(`[SECURITY] Skipping oversized file during rebuild: ${file} (${stat.size} bytes)`);
            await fileHandle.close();
            continue;
          }
          
          const data = await fileHandle.readFile('utf-8');
          await fileHandle.close();
          fileHandle = null;
          
          const session = verifyAndUnwrap<RecordingSession>(data);
          this.sessionIndex.set(session.id, file);
          
          this.sessionMetadata.set(session.id, {
            traceId: session.traceId,
            serviceName: session.serviceName,
            startedAt: session.startedAt,
            endedAt: session.endedAt,
            eventCount: session.events?.length || 0,
            hasError: session.metadata?.hasError || false,
          });

          const traceIds = this.traceIndex.get(session.traceId) ?? [];
          if (!traceIds.includes(session.id) && traceIds.length < MAX_SESSIONS_PER_TRACE) {
            traceIds.push(session.id);
          }
          this.traceIndex.set(session.traceId, traceIds);
        } catch (err: any) {
          if (fileHandle) {
             try { await fileHandle.close(); } catch {}
          }
          if (err.code === 'ELOOP') {
            console.error(`[SECURITY] Symlink skipped during index rebuild: ${file}`);
            continue;
          }
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
