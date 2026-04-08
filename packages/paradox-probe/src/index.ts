// ============================================================================
// PARADOX PROBE — Main Entry Point
//
// Usage:
//   import { ParadoxProbe } from '@paradox/probe';
//
//   const probe = new ParadoxProbe({ serviceName: 'user-service' });
//   app.use(probe.middleware());
//
//   // Later, to stop:
//   await probe.shutdown();
// ============================================================================

import type { ProbeConfig, RecordingSession } from '@paradox/core';
import { DEFAULT_PROBE_CONFIG, HybridLogicalClock, ulid } from '@paradox/core';
import { installGlobalInterceptors, uninstallGlobalInterceptors } from './interceptors/globals.js';
import { installFetchInterceptor, uninstallFetchInterceptor } from './interceptors/http-outgoing.js';
import { createHttpIncomingMiddleware } from './interceptors/http-incoming.js';
import { CollectorClient } from './transport/collector-client.js';

export type { SessionCallback } from './interceptors/http-incoming.js';

export class ParadoxProbe {
  private readonly config: ProbeConfig;
  private readonly hlc: HybridLogicalClock;
  private readonly collector: CollectorClient;
  private started = false;

  constructor(userConfig: Partial<ProbeConfig> & { serviceName: string }) {
    this.config = { ...DEFAULT_PROBE_CONFIG, ...userConfig };
    this.hlc = new HybridLogicalClock(`${this.config.serviceName}-${ulid().slice(0, 8)}`);
    this.collector = new CollectorClient({
      collectorUrl: this.config.collectorUrl,
      flushIntervalMs: this.config.flushIntervalMs,
      maxBufferSize: this.config.bufferSize,
    });
  }

  /**
   * Get the Express middleware for recording incoming requests.
   * This is the primary integration point.
   */
  middleware(): import('express').RequestHandler {
    if (!this.started) {
      this.start();
    }
    return createHttpIncomingMiddleware(this.config, this.hlc, (session) => {
      this.collector.enqueue(session);
    });
  }

  /**
   * Start the probe — installs interceptors and begins recording.
   * Called automatically by middleware(), but can be called manually.
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    installGlobalInterceptors();
    installFetchInterceptor();
    this.collector.start();

    console.log(
      `[PARADOX] Probe started for "${this.config.serviceName}" ` +
      `→ collector: ${this.config.collectorUrl} ` +
      `| sampling: ${this.config.samplingRate * 100}%`
    );
  }

  /**
   * Stop the probe — uninstalls interceptors and flushes buffer.
   */
  async shutdown(): Promise<void> {
    if (!this.started) return;
    this.started = false;

    uninstallGlobalInterceptors();
    uninstallFetchInterceptor();
    await this.collector.stop();

    console.log(`[PARADOX] Probe stopped for "${this.config.serviceName}"`);
  }

  /**
   * Enable local-only mode — stores recordings in memory instead of
   * sending to a collector. Perfect for development and testing.
   */
  enableLocalMode(): this {
    this.collector.enableLocalStore();
    return this;
  }

  /** Get recordings stored in local mode */
  getRecordings(): RecordingSession[] {
    return this.collector.getLocalRecordings();
  }

  /** Clear local recordings */
  clearRecordings(): void {
    this.collector.clearLocalRecordings();
  }

  /** Get the current probe configuration */
  getConfig(): Readonly<ProbeConfig> {
    return { ...this.config };
  }

  /** Dynamically enable/disable recording */
  setEnabled(enabled: boolean): void {
    this.config.enabled = enabled;
  }

  /** Dynamically change sampling rate */
  setSamplingRate(rate: number): void {
    this.config.samplingRate = Math.max(0, Math.min(1, rate));
  }
}

// Re-export useful types
export { RecordingSession as RecordingContext } from './recording-context.js';
export { getActiveSession } from './recording-context.js';
