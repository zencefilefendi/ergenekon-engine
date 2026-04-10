// ============================================================================
// PARADOX PROBE — Spill Buffer
//
// When the collector is unreachable and the in-memory buffer is full,
// sessions spill to disk as append-only NDJSON files.
// This ensures ZERO recording loss during collector outages.
//
// The spill directory defaults to ~/.paradox/spill/
// Each spill file is fsync'd after every append.
// ============================================================================

import { mkdirSync, appendFileSync, readdirSync, readFileSync, unlinkSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { RecordingSession } from '@paradox/core';

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
    this.spillDir = config.spillDir ?? join(homedir(), '.paradox', 'spill');
    this.maxSpillFiles = config.maxSpillFiles ?? 100;
    this.maxLinesPerFile = config.maxLinesPerFile ?? 1000;

    try {
      mkdirSync(this.spillDir, { recursive: true });
    } catch {
      // Best effort — if we can't write, we'll catch in append
    }

    this.currentFile = this.newFileName();
  }

  /** Append a session to the spill file (fsync'd) */
  append(session: RecordingSession): boolean {
    try {
      const line = JSON.stringify(session) + '\n';
      const filePath = join(this.spillDir, this.currentFile);

      appendFileSync(filePath, line, 'utf-8');

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
              sessions.push(JSON.parse(line) as RecordingSession);
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
    return `spill-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ndjson`;
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

      while (files.length > this.maxSpillFiles) {
        const oldest = files.shift()!;
        try {
          unlinkSync(join(this.spillDir, oldest));
        } catch {
          // best effort
        }
      }
    } catch {
      // ignore
    }
  }
}
