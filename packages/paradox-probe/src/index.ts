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
import { installTimerInterceptors, uninstallTimerInterceptors } from './interceptors/timers.js';
import { installErrorInterceptors, uninstallErrorInterceptors } from './interceptors/errors.js';
import { installPgInterceptor, installRedisInterceptor, installMongoInterceptor, uninstallDatabaseInterceptors } from './interceptors/database.js';
import { createHttpIncomingMiddleware } from './interceptors/http-incoming.js';
import { CollectorClient } from './transport/collector-client.js';
import { SamplingEngine, type SamplingConfig, DEFAULT_SAMPLING_CONFIG } from './sampling.js';

export type { SessionCallback } from './interceptors/http-incoming.js';
export { SamplingEngine, type SamplingConfig, type SamplingDecision, type SamplingReason } from './sampling.js';
export { redactDeep, redactHeaders, type RedactionConfig, DEFAULT_REDACTION_CONFIG } from './redaction.js';

export class ParadoxProbe {
  private readonly config: ProbeConfig;
  private readonly hlc: HybridLogicalClock;
  private readonly collector: CollectorClient;
  private readonly sampler: SamplingEngine;
  private started = false;

  constructor(userConfig: Partial<ProbeConfig> & { serviceName: string } & { sampling?: Partial<SamplingConfig> }) {
    this.config = { ...DEFAULT_PROBE_CONFIG, ...userConfig };
    this.hlc = new HybridLogicalClock(`${this.config.serviceName}-${ulid().slice(0, 8)}`);
    this.collector = new CollectorClient({
      collectorUrl: this.config.collectorUrl,
      flushIntervalMs: this.config.flushIntervalMs,
      maxBufferSize: this.config.bufferSize,
    });
    this.sampler = new SamplingEngine({
      baseRate: this.config.samplingRate,
      ...userConfig.sampling,
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
    }, this.sampler);
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
    installTimerInterceptors();
    installErrorInterceptors();

    // Auto-detect and install database interceptors
    const dbDrivers: string[] = [];
    if (installPgInterceptor()) dbDrivers.push('pg');
    if (installRedisInterceptor()) dbDrivers.push('ioredis');
    if (installMongoInterceptor()) dbDrivers.push('mongoose');

    this.collector.start();

    const samplingInfo = `smart (base: ${this.config.samplingRate * 100}%, errors: 100%, adaptive: on)`;
    console.log(
      `[PARADOX] Probe started for "${this.config.serviceName}" ` +
      `→ collector: ${this.config.collectorUrl} ` +
      `| sampling: ${samplingInfo}` +
      (dbDrivers.length > 0 ? ` | db: ${dbDrivers.join(', ')}` : '')
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
    uninstallTimerInterceptors();
    uninstallErrorInterceptors();
    uninstallDatabaseInterceptors();
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
    this.sampler.updateConfig({ baseRate: this.config.samplingRate });
  }

  /** Get smart sampling statistics */
  getSamplingStats() {
    return this.sampler.getStats();
  }

  /** Update smart sampling configuration at runtime */
  updateSamplingConfig(partial: Partial<SamplingConfig>): void {
    this.sampler.updateConfig(partial);
  }

  /** Force record next N requests (debug mode) */
  forceRecord(count: number = 1): void {
    this.sampler.forceRecord(count);
  }
}

// Re-export useful types
export { RecordingSession as RecordingContext } from './recording-context.js';
export { getActiveSession } from './recording-context.js';
