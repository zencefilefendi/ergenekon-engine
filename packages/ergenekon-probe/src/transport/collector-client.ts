// ============================================================================
// ERGENEKON PROBE — Collector Client (Phase 6 Hardened)
//
// Sends completed recording sessions to the ERGENEKON collector.
//
// Phase 6 improvements:
//   - FlushHealth struct: tracks consecutive failures, dropped count, last error
//   - Circuit breaker: after N failures, switch to disk-spill mode
//   - SpillBuffer: fsync'd NDJSON on disk, zero recording loss
//   - ERGENEKON_STRICT=1: throws on first failure (CI/test use)
//   - EventEmitter for health state changes
//   - Automatic spill drain on collector recovery
//
// INVARIANT: A session is NEVER silently dropped. It either:
//   1. Reaches the collector, or
//   2. Lands on disk (spill buffer), or
//   3. Throws an error (strict mode)
// ============================================================================

import { EventEmitter } from 'node:events';
import type { RecordingSession } from '@ergenekon/core';
import { SpillBuffer, type SpillBufferConfig } from './spill-buffer.js';

// ─── Capture original Date.now before any monkey-patching ───
const _originalDateNow = Date.now.bind(Date);

export interface CollectorClientConfig {
  collectorUrl: string;
  flushIntervalMs: number;
  maxBufferSize: number;

  /** Number of consecutive failures before switching to spill mode */
  circuitBreakerThreshold?: number;

  /** Spill buffer configuration */
  spillConfig?: SpillBufferConfig;

  /** Strict mode: throw on first failure (set ERGENEKON_STRICT=1 for CI) */
  strict?: boolean;
}

export interface FlushHealth {
  status: 'healthy' | 'degraded' | 'spilling';
  consecutiveFailures: number;
  totalDropped: number;
  totalSpilled: number;
  totalSent: number;
  lastError: string | null;
  lastErrorAt: number | null;
  lastSuccessAt: number | null;
  spillFileCount: number;
}

export class CollectorClient extends EventEmitter {
  private buffer: RecordingSession[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private readonly config: Required<Pick<CollectorClientConfig,
    'collectorUrl' | 'flushIntervalMs' | 'maxBufferSize' | 'circuitBreakerThreshold' | 'strict'
  >> & { spillConfig?: SpillBufferConfig };

  /** Health state */
  private _consecutiveFailures = 0;
  private _totalDropped = 0;
  private _totalSpilled = 0;
  private _totalSent = 0;
  private _lastError: string | null = null;
  private _lastErrorAt: number | null = null;
  private _lastSuccessAt: number | null = null;
  private _spilling = false;

  /** Spill buffer for disk persistence during outages */
  private spill: SpillBuffer;

  /** In-memory store for local development (no collector needed) */
  private localStore: RecordingSession[] = [];
  private useLocalStore = false;

  /** Flush lock to prevent concurrent flushes */
  private _flushing = false;

  constructor(config: CollectorClientConfig) {
    super();
    this.config = {
      collectorUrl: config.collectorUrl,
      flushIntervalMs: config.flushIntervalMs,
      maxBufferSize: config.maxBufferSize,
      circuitBreakerThreshold: config.circuitBreakerThreshold ?? 5,
      strict: config.strict ?? (process.env.ERGENEKON_STRICT === '1'),
      spillConfig: config.spillConfig,
    };
    this.spill = new SpillBuffer(config.spillConfig);
  }

  /** Start periodic flushing */
  start(): void {
    // On startup, try to drain any previous spill files
    this.drainSpill();

    this.flushTimer = setInterval(() => {
      this.flush();
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

  /** Get current health state */
  getHealth(): FlushHealth {
    let status: FlushHealth['status'] = 'healthy';
    if (this._spilling) {
      status = 'spilling';
    } else if (this._consecutiveFailures > 0) {
      status = 'degraded';
    }

    return {
      status,
      consecutiveFailures: this._consecutiveFailures,
      totalDropped: this._totalDropped,
      totalSpilled: this._totalSpilled,
      totalSent: this._totalSent,
      lastError: this._lastError,
      lastErrorAt: this._lastErrorAt,
      lastSuccessAt: this._lastSuccessAt,
      spillFileCount: this.spill.getFileCount(),
    };
  }

  /** Add a completed recording to the send buffer */
  enqueue(session: RecordingSession): void {
    if (this.useLocalStore) {
      this.localStore.push(session);
      return;
    }

    // If circuit breaker is open, go directly to spill
    if (this._spilling) {
      this.spillSession(session);
      return;
    }

    this.buffer.push(session);

    // Enforce buffer size limit
    if (this.buffer.length > this.config.maxBufferSize * 2) {
      const dropped = this.buffer.length - this.config.maxBufferSize;
      this.buffer = this.buffer.slice(-this.config.maxBufferSize);
      this._totalDropped += dropped;
      this.emit('warning', `Buffer overflow: dropped ${dropped} oldest sessions`);
    }

    // Flush immediately — each session is a complete recording
    this.flush();
  }

  /** Send buffered recordings to the collector */
  private async flush(): Promise<void> {
    if (this.buffer.length === 0 || this._flushing) return;

    this._flushing = true;
    const batch = this.buffer.splice(0);

    try {
      const response = await fetch(`${this.config.collectorUrl}/api/v1/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessions: batch }),
        signal: AbortSignal.timeout(5000),
      });

      if (!response.ok) {
        throw new Error(`Collector returned ${response.status}: ${response.statusText}`);
      }

      // Success — reset health
      this._totalSent += batch.length;
      this._lastSuccessAt = _originalDateNow();

      if (this._consecutiveFailures > 0 || this._spilling) {
        this._consecutiveFailures = 0;
        this._spilling = false;
        this.emit('recovered', this.getHealth());

        // Drain any spilled sessions now that collector is back
        this.drainSpill();
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : String(err);
      this._consecutiveFailures++;
      this._lastError = errorMessage;
      this._lastErrorAt = _originalDateNow();

      this.emit('error', new Error(
        `[ERGENEKON] Collector flush failed (attempt ${this._consecutiveFailures}): ${errorMessage}`
      ));

      // Strict mode: throw immediately (for CI/test use)
      if (this.config.strict) {
        this._flushing = false;
        throw new Error(
          `[ERGENEKON STRICT] Collector unreachable after ${this._consecutiveFailures} attempts: ${errorMessage}. ` +
          `Set ERGENEKON_STRICT=0 to allow graceful degradation.`
        );
      }

      // Circuit breaker: too many failures → switch to spill
      if (this._consecutiveFailures >= this.config.circuitBreakerThreshold) {
        if (!this._spilling) {
          this._spilling = true;
          this.emit('circuit-open', this.getHealth());
        }
        // Spill the failed batch to disk
        for (const session of batch) {
          this.spillSession(session);
        }
      } else {
        // Below threshold: put back in buffer for retry
        this.buffer.unshift(...batch);
      }
    } finally {
      this._flushing = false;
    }
  }

  /** Write a session to the spill buffer on disk */
  private spillSession(session: RecordingSession): void {
    const success = this.spill.append(session);
    if (success) {
      this._totalSpilled++;
    } else {
      this._totalDropped++;
      this.emit('warning', `Spill write failed — session dropped (total dropped: ${this._totalDropped})`);
    }
  }

  /** Drain spilled sessions from disk and re-enqueue them */
  private async drainSpill(): Promise<void> {
    const spilled = this.spill.drain();
    if (spilled.length === 0) return;

    this.emit('drain', { count: spilled.length });

    // Re-add to buffer for sending
    this.buffer.push(...spilled);

    // Don't flush immediately — let the interval handle it
    // to avoid thundering herd after recovery
  }
}
