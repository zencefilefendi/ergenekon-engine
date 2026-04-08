// ============================================================================
// PARADOX COLLECTOR — Storage Engine
//
// Phase 0: File-based storage with JSON serialization.
// Each recording session is stored as a separate JSON file.
// Sessions are indexed by trace ID for fast lookup.
//
// Future: Content-Addressable Storage (CAS) with deduplication,
// tiered storage (RAM → SSD → S3), delta compression.
// ============================================================================

import { createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { RecordingSession } from '@paradox/core';

export class FileStorage {
  private readonly baseDir: string;
  private readonly sessionsDir: string;
  private readonly indexDir: string;

  // In-memory index for fast lookups
  private traceIndex = new Map<string, string[]>(); // traceId → sessionIds
  private sessionIndex = new Map<string, string>();  // sessionId → filename

  constructor(baseDir: string) {
    this.baseDir = baseDir;
    this.sessionsDir = join(baseDir, 'sessions');
    this.indexDir = join(baseDir, 'index');
  }

  /** Initialize storage directories */
  async init(): Promise<void> {
    await mkdir(this.sessionsDir, { recursive: true });
    await mkdir(this.indexDir, { recursive: true });
    await this.rebuildIndex();
  }

  /** Store a recording session */
  async store(session: RecordingSession): Promise<string> {
    const filename = `${session.id}.json`;
    const filepath = join(this.sessionsDir, filename);

    await writeFile(filepath, JSON.stringify(session, null, 2), 'utf-8');

    // Update in-memory index
    this.sessionIndex.set(session.id, filename);
    const traceIds = this.traceIndex.get(session.traceId) ?? [];
    traceIds.push(session.id);
    this.traceIndex.set(session.traceId, traceIds);

    return session.id;
  }

  /** Load a recording session by ID */
  async load(sessionId: string): Promise<RecordingSession | null> {
    const filename = this.sessionIndex.get(sessionId);
    if (!filename) return null;

    try {
      const filepath = join(this.sessionsDir, filename);
      const data = await readFile(filepath, 'utf-8');
      return JSON.parse(data) as RecordingSession;
    } catch {
      return null;
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

  /** Rebuild in-memory index from disk */
  private async rebuildIndex(): Promise<void> {
    this.sessionIndex.clear();
    this.traceIndex.clear();

    try {
      const files = await readdir(this.sessionsDir);
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        try {
          const data = await readFile(join(this.sessionsDir, file), 'utf-8');
          const session = JSON.parse(data) as RecordingSession;
          this.sessionIndex.set(session.id, file);
          const traceIds = this.traceIndex.get(session.traceId) ?? [];
          traceIds.push(session.id);
          this.traceIndex.set(session.traceId, traceIds);
        } catch {
          // Corrupted file — skip
        }
      }
    } catch {
      // No sessions directory yet
    }
  }
}
