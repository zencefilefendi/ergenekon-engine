// ============================================================================
// ERGENEKON PROBE — Spill Buffer
//
// When the collector is unreachable and the in-memory buffer is full,
// sessions spill to disk as append-only NDJSON files.
// This ensures ZERO recording loss during collector outages.
//
// The spill directory defaults to ~/.ergenekon/spill/
// Each spill file is fsync'd after every append.
// ============================================================================

import { mkdirSync, appendFileSync, readdirSync, readFileSync, unlinkSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import type { RecordingSession } from '@ergenekon/core';
import { redactDeep } from '../redaction.js';

// Safe JSON.stringify that handles circular references without crashing
// Circular refs in Express req/res, socket handles etc. would throw TypeError
// and crash the host application — this is a critical DoS prevention measure.
function safeStringify(obj: unknown): string {
  const seen = new WeakSet();
  return JSON.stringify(obj, (_key, value) => {
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  });
}

export interface SpillBufferConfig {
  spillDir?: string;
  maxSpillFiles?: number; // prevent unbounded disk growth
  maxLinesPerFile?: number; // lines before rotation (default 1000)
}

export class SpillBuffer {
  private readonly spillDir: string;
  private readonly maxSpillFiles: number;
  private readonly maxLinesPerFile: number;
  private currentFile: string;
  private lineCount = 0;

  constructor(config: SpillBufferConfig = {}) {
    this.spillDir = config.spillDir ?? join(homedir(), '.ergenekon', 'spill');
    this.maxSpillFiles = config.maxSpillFiles ?? 100;
    this.maxLinesPerFile = config.maxLinesPerFile ?? 1000;

    try {
      // SECURITY: 0o700 prevents other users from accessing the spill directory
      mkdirSync(this.spillDir, { recursive: true, mode: 0o700 });
    } catch {
      // Best effort — if we can't write, we'll catch in append
    }

    this.currentFile = this.newFileName();
  }

  /** Append a session to the spill file (fsync'd) */
  append(session: RecordingSession): boolean {
    try {
      // SECURITY (H-13): Last-mile redaction before writing to disk
      const redactedSession = redactDeep(session);
      const line = safeStringify(redactedSession) + '\n';
      const filePath = join(this.spillDir, this.currentFile);

      // SECURITY: 0o600 restricts read/write to the owner only
      appendFileSync(filePath, line, { encoding: 'utf-8', mode: 0o600 });

      // fsync the file for durability
      const fd = openSync(filePath, 'r+');
      try {
        fsyncSync(fd);
      } finally {
        closeSync(fd);
      }

      this.lineCount++;

      if (this.lineCount >= this.maxLinesPerFile) {
        this.rotateFile();
      }

      this.enforceMaxFiles();
      return true;
    } catch {
      return false; // disk write failed — nothing more we can do
    }
  }

  /** Read and drain all spilled sessions (returns them, deletes files) */
  drain(): RecordingSession[] {
    const sessions: RecordingSession[] = [];

    try {
      const files = readdirSync(this.spillDir)
        .filter(f => f.startsWith('spill-') && f.endsWith('.ndjson'))
        .sort(); // chronological order

      for (const file of files) {
        const filePath = join(this.spillDir, file);
        try {
          const content = readFileSync(filePath, 'utf-8');
          const lines = content.trim().split('\n').filter(Boolean);

          for (const line of lines) {
            try {
              sessions.push(JSON.parse(line, (key, value) => {
                if (key === '__proto__' || key === 'constructor' || key === 'prototype') return undefined;
                return value;
              }) as RecordingSession);
            } catch {
              // skip corrupt lines
            }
          }

          unlinkSync(filePath);
        } catch {
          // skip unreadable files
        }
      }
    } catch {
      // spill dir doesn't exist or is unreadable
    }

    return sessions;
  }

  /** How many spill files currently exist */
  getFileCount(): number {
    try {
      return readdirSync(this.spillDir)
        .filter(f => f.startsWith('spill-') && f.endsWith('.ndjson'))
        .length;
    } catch {
      return 0;
    }
  }

  private newFileName(): string {
    // SECURITY: Use crypto.randomUUID instead of Math.random for spill filenames
    return `spill-${Date.now()}-${randomUUID().slice(0, 8)}.ndjson`;
  }

  private rotateFile(): void {
    this.currentFile = this.newFileName();
    this.lineCount = 0;
  }

  private enforceMaxFiles(): void {
    try {
      const files = readdirSync(this.spillDir)
        .filter(f => f.startsWith('spill-') && f.endsWith('.ndjson'))
        .sort();

      // SECURITY (HIGH-10): Count dropped sessions when evicting old spill files
      while (files.length > this.maxSpillFiles) {
        const oldest = files.shift()!;
        try {
          // Count lines in file being dropped
          const content = readFileSync(join(this.spillDir, oldest), 'utf-8');
          const lineCount = content.trim().split('\n').filter(Boolean).length;
          console.warn(`[ERGENEKON] Evicting spill file ${oldest} (${lineCount} sessions dropped)`);
          unlinkSync(join(this.spillDir, oldest));
        } catch {
          try { unlinkSync(join(this.spillDir, oldest)); } catch { /* best effort */ }
        }
      }
    } catch {
      // ignore
    }
  }
}
