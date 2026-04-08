// ============================================================================
// PARADOX PROBE — Collector Client
//
// Sends completed recording sessions to the PARADOX collector.
// Uses batching and async flushing to minimize overhead on the application.
//
// Design principles:
// - Never block the application's event loop
// - Gracefully handle collector being unavailable
// - Buffer recordings if collector is down, flush when it's back
// ============================================================================

import type { RecordingSession } from '@paradox/core';

export interface CollectorClientConfig {
  collectorUrl: string;
  flushIntervalMs: number;
  maxBufferSize: number;
}

export class CollectorClient {
  private buffer: RecordingSession[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly config: CollectorClientConfig;

  /** In-memory store for local development (no collector needed) */
  private localStore: RecordingSession[] = [];
  private useLocalStore = false;

  constructor(config: CollectorClientConfig) {
    this.config = config;
  }

  /** Start periodic flushing */
  start(): void {
    this.flushTimer = setInterval(() => {
      this.flush().catch(() => {
        // Silent fail — recordings stay in buffer for next flush
      });
    }, this.config.flushIntervalMs);

    // Don't keep Node.js alive just for flushing
    if (this.flushTimer.unref) {
      this.flushTimer.unref();
    }
  }

  /** Stop periodic flushing and flush remaining buffer */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
  }

  /** Enable local-only mode (stores recordings in memory, no network) */
  enableLocalStore(): void {
    this.useLocalStore = true;
  }

  /** Get all locally stored recordings */
  getLocalRecordings(): RecordingSession[] {
    return [...this.localStore];
  }

  /** Clear local recordings */
  clearLocalRecordings(): void {
    this.localStore = [];
  }

  /** Add a completed recording to the send buffer */
  enqueue(session: RecordingSession): void {
    if (this.useLocalStore) {
      this.localStore.push(session);
      return;
    }

    this.buffer.push(session);

    // Flush immediately — each session is a complete recording
    this.flush().catch(() => {});
  }

  /** Send buffered recordings to the collector */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    const batch = this.buffer.splice(0);

    try {
      const response = await fetch(`${this.config.collectorUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: batch }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        // Put recordings back in buffer for retry
        this.buffer.unshift(...batch);
      }
    } catch {
      // Collector unreachable — put recordings back
      this.buffer.unshift(...batch);

      // Trim buffer if it's growing too large
      if (this.buffer.length > this.config.maxBufferSize * 2) {
        this.buffer = this.buffer.slice(-this.config.maxBufferSize);
      }
    }
  }
}
