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
//
// License System:
//   The probe automatically searches for a license file on startup:
//     1. PARADOX_LICENSE_KEY env var (inline JSON)
//     2. PARADOX_LICENSE env var (file path)
//     3. .paradox-license.json in current directory
//     4. ~/.paradox-license.json in home directory
//
//   No license = Community mode (basic features only)
//   Pro license = All interceptors + sampling + redaction + UI
//   Enterprise  = Everything + SSO + RBAC + unlimited
// ============================================================================

import type { ProbeConfig, RecordingSession, LicenseValidation, LicenseTier } from '@paradox/core';
import {
  DEFAULT_PROBE_CONFIG,
  HybridLogicalClock,
  ulid,
  loadLicense,
  hasFeature,
  getTierDisplay,
} from '@paradox/core';
import { installGlobalInterceptors, uninstallGlobalInterceptors } from './interceptors/globals.js';
import { installFetchInterceptor, uninstallFetchInterceptor } from './interceptors/http-outgoing.js';
import { installTimerInterceptors, uninstallTimerInterceptors } from './interceptors/timers.js';
import { installErrorInterceptors, uninstallErrorInterceptors } from './interceptors/errors.js';
import { installPgInterceptor, installRedisInterceptor, installMongoInterceptor, uninstallDatabaseInterceptors } from './interceptors/database.js';
import { installFsInterceptor, uninstallFsInterceptor } from './interceptors/fs.js';
import { installDnsInterceptor, uninstallDnsInterceptor } from './interceptors/dns.js';
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
  private licenseValidation: LicenseValidation | null = null;

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

    // Load and validate license on construction
    this.licenseValidation = loadLicense();
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
   *
   * Interceptors are gated by license tier:
   *   Community: globals + http (basic record/replay)
   *   Pro:       + fs + dns + database + sampling + redaction
   *   Enterprise: + all future features
   */
  start(): void {
    if (this.started) return;
    this.started = true;

    const license = this.licenseValidation!;
    const tier = license.tier;

    // ── Always installed (Community + Pro + Enterprise) ──────────
    installGlobalInterceptors();
    installFetchInterceptor();
    installTimerInterceptors();
    installErrorInterceptors();

    // ── Pro+ features ───────────────────────────────────────────
    const gatedFeatures: string[] = [];

    if (hasFeature(license, 'fs_interceptor')) {
      installFsInterceptor();
      gatedFeatures.push('fs');
    }

    if (hasFeature(license, 'dns_interceptor')) {
      installDnsInterceptor();
      gatedFeatures.push('dns');
    }

    // Auto-detect and install database interceptors (Pro+)
    const dbDrivers: string[] = [];
    if (hasFeature(license, 'database_interceptor')) {
      if (installPgInterceptor()) dbDrivers.push('pg');
      if (installRedisInterceptor()) dbDrivers.push('ioredis');
      if (installMongoInterceptor()) dbDrivers.push('mongoose');
      if (dbDrivers.length > 0) gatedFeatures.push(`db(${dbDrivers.join(',')})`);
    }

    if (hasFeature(license, 'smart_sampling')) {
      gatedFeatures.push('sampling');
    }

    if (hasFeature(license, 'deep_redaction')) {
      gatedFeatures.push('redaction');
    }

    this.collector.start();

    // ── Startup Banner ──────────────────────────────────────────
    const tierDisplay = getTierDisplay(tier);
    const samplingInfo = hasFeature(license, 'smart_sampling')
      ? `smart (base: ${this.config.samplingRate * 100}%, errors: 100%, adaptive: on)`
      : `basic (${this.config.samplingRate * 100}%)`;

    const parts = [
      `[PARADOX] Probe started for "${this.config.serviceName}"`,
      `→ license: ${tierDisplay}`,
      `→ collector: ${this.config.collectorUrl}`,
      `| sampling: ${samplingInfo}`,
    ];

    if (gatedFeatures.length > 0) {
      parts.push(`| pro: ${gatedFeatures.join(', ')}`);
    }

    if (license.daysUntilExpiry > 0 && license.daysUntilExpiry <= 30) {
      parts.push(`⚠️  License expires in ${license.daysUntilExpiry} days`);
    }

    console.log(parts.join(' '));

    // Community tier upgrade hint
    if (tier === 'community') {
      console.log(
        `[PARADOX] 🆓 Running in Community mode — ` +
        `upgrade to Pro for distributed replay, smart sampling, and more. ` +
        `Visit https://paradoxengine.dev/pricing`
      );
    }
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
    uninstallFsInterceptor();
    uninstallDnsInterceptor();
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

  /** Get the current license validation result */
  getLicense(): Readonly<LicenseValidation> {
    return this.licenseValidation!;
  }

  /** Get the current license tier */
  getTier(): LicenseTier {
    return this.licenseValidation?.tier ?? 'community';
  }

  /** Check if a specific feature is available in the current license */
  hasFeature(feature: string): boolean {
    if (!this.licenseValidation) return false;
    return hasFeature(this.licenseValidation, feature as any);
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
