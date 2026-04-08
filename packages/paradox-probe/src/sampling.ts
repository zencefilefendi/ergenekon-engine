// ============================================================================
// PARADOX PROBE — Smart Sampling Engine
//
// Not every request needs to be recorded. Smart sampling decides WHICH
// requests to record based on multiple signals:
//
// 1. ERROR sampling:   Errors are ALWAYS recorded (100%)
// 2. LATENCY sampling: Slow requests (>P99) are always recorded
// 3. NEW PATH sampling: First time seeing a route? Record it.
// 4. TRACE sampling:   Upstream says "record this"? Obey.
// 5. RANDOM sampling:  Everything else → configurable rate (default 1%)
//
// Uses TAIL-BASED sampling: we buffer everything in a ring buffer,
// then decide at request END whether to keep or discard.
// This ensures we NEVER miss errors or anomalies.
// ============================================================================

import { originalDateNow } from './internal-clock.js';

export interface SamplingConfig {
  /** Base random sampling rate (0.0 to 1.0). Default: 0.01 (1%) */
  baseRate: number;

  /** Always record requests slower than this (ms). 0 = disabled */
  latencyThresholdMs: number;

  /** Always record requests to never-before-seen routes */
  sampleNewPaths: boolean;

  /** Always record requests that result in errors (5xx, exceptions) */
  alwaysSampleErrors: boolean;

  /** Honor upstream sampling decisions (trace header) */
  honorUpstreamDecision: boolean;

  /** Max unique paths to track (prevent memory leak on dynamic routes) */
  maxTrackedPaths: number;

  /** Adaptive: increase sampling when error rate spikes */
  adaptiveEnabled: boolean;

  /** Adaptive: if error rate exceeds this %, bump sampling to 100% temporarily */
  adaptiveErrorThreshold: number;
}

export const DEFAULT_SAMPLING_CONFIG: SamplingConfig = {
  baseRate: 0.01,
  latencyThresholdMs: 0,
  sampleNewPaths: true,
  alwaysSampleErrors: true,
  honorUpstreamDecision: true,
  maxTrackedPaths: 10000,
  adaptiveEnabled: true,
  adaptiveErrorThreshold: 0.05, // 5% error rate triggers full sampling
};

export type SamplingDecision = {
  shouldRecord: boolean;
  reason: SamplingReason;
};

export type SamplingReason =
  | 'error'          // Request resulted in error
  | 'latency'        // Request exceeded latency threshold
  | 'new_path'       // First time seeing this route
  | 'upstream'       // Upstream service requested recording
  | 'adaptive'       // Error rate spike detected
  | 'random'         // Random sampling (base rate)
  | 'forced'         // Manually forced (debug mode)
  | 'dropped';       // Not sampled

/**
 * Smart Sampling Engine — decides which requests to record.
 *
 * HEAD decision: Quick yes/no at request start (for trace propagation).
 * TAIL decision: Final yes/no at request end (can upgrade to "yes" if error).
 */
export class SamplingEngine {
  private config: SamplingConfig;
  private seenPaths = new Set<string>();

  // Sliding window stats for adaptive sampling
  private windowSize = 60_000; // 1 minute window
  private requestTimestamps: number[] = [];
  private errorTimestamps: number[] = [];

  // Adaptive state
  private adaptiveOverride = false;
  private adaptiveUntil = 0;

  constructor(config: Partial<SamplingConfig> = {}) {
    this.config = { ...DEFAULT_SAMPLING_CONFIG, ...config };
  }

  /**
   * HEAD decision — called at request START.
   * Makes a preliminary sampling decision.
   * Can be overridden by TAIL decision later.
   */
  headDecision(opts: {
    path: string;
    upstreamSampled?: boolean;
  }): SamplingDecision {
    // Upstream says record → obey
    if (this.config.honorUpstreamDecision && opts.upstreamSampled) {
      return { shouldRecord: true, reason: 'upstream' };
    }

    // Adaptive: error rate spike → record everything
    if (this.config.adaptiveEnabled && this.isAdaptiveActive()) {
      return { shouldRecord: true, reason: 'adaptive' };
    }

    // New path → record
    if (this.config.sampleNewPaths && !this.seenPaths.has(this.normalizePath(opts.path))) {
      return { shouldRecord: true, reason: 'new_path' };
    }

    // Random sampling
    if (Math.random() < this.config.baseRate) {
      return { shouldRecord: true, reason: 'random' };
    }

    // Default: don't record (but TAIL can override)
    return { shouldRecord: false, reason: 'dropped' };
  }

  /**
   * TAIL decision — called at request END.
   * Can UPGRADE a "no" to "yes" based on outcome.
   * Can NEVER downgrade a "yes" to "no".
   */
  tailDecision(
    headDecision: SamplingDecision,
    opts: {
      path: string;
      statusCode: number;
      durationMs: number;
      hasError: boolean;
    }
  ): SamplingDecision {
    const now = originalDateNow();

    // Track stats
    this.requestTimestamps.push(now);
    if (opts.hasError || opts.statusCode >= 500) {
      this.errorTimestamps.push(now);
    }

    // Track seen paths
    const normalized = this.normalizePath(opts.path);
    if (this.seenPaths.size < this.config.maxTrackedPaths) {
      this.seenPaths.add(normalized);
    }

    // If head already said yes, keep it
    if (headDecision.shouldRecord) {
      return headDecision;
    }

    // UPGRADE: Error → always record
    if (this.config.alwaysSampleErrors && (opts.hasError || opts.statusCode >= 500)) {
      this.checkAdaptiveTrigger();
      return { shouldRecord: true, reason: 'error' };
    }

    // UPGRADE: Latency spike → record
    if (this.config.latencyThresholdMs > 0 && opts.durationMs > this.config.latencyThresholdMs) {
      return { shouldRecord: true, reason: 'latency' };
    }

    // Keep original decision
    return headDecision;
  }

  /**
   * Force recording for the next N requests (debug mode).
   */
  forceRecord(count: number = 1): void {
    // Temporarily set base rate to 1.0
    const originalRate = this.config.baseRate;
    this.config.baseRate = 1.0;
    setTimeout(() => {
      this.config.baseRate = originalRate;
    }, count * 10000); // Rough: assume 1 req/10s
  }

  /**
   * Get current sampling statistics.
   */
  getStats(): {
    seenPaths: number;
    recentRequests: number;
    recentErrors: number;
    errorRate: number;
    adaptiveActive: boolean;
    currentRate: number;
  } {
    this.pruneWindow();
    const errorRate = this.requestTimestamps.length > 0
      ? this.errorTimestamps.length / this.requestTimestamps.length
      : 0;

    return {
      seenPaths: this.seenPaths.size,
      recentRequests: this.requestTimestamps.length,
      recentErrors: this.errorTimestamps.length,
      errorRate,
      adaptiveActive: this.isAdaptiveActive(),
      currentRate: this.isAdaptiveActive() ? 1.0 : this.config.baseRate,
    };
  }

  /** Update config at runtime */
  updateConfig(partial: Partial<SamplingConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  // ── Internal ────────────────────────────────────────────────────

  /**
   * Normalize path for deduplication.
   * /api/users/123 → /api/users/:id
   * /api/orders/ORD-ABC → /api/orders/:id
   */
  private normalizePath(path: string): string {
    return path
      .replace(/\/\d+/g, '/:id')               // Numeric IDs
      .replace(/\/[0-9a-f]{8,}/gi, '/:id')     // Hex IDs (UUIDs, etc)
      .replace(/\/[A-Z]{2,4}-[A-Z0-9]+/g, '/:id') // Business IDs (ORD-123)
      .replace(/\?.*$/, '');                    // Strip query params
  }

  private isAdaptiveActive(): boolean {
    return this.adaptiveOverride && originalDateNow() < this.adaptiveUntil;
  }

  private checkAdaptiveTrigger(): void {
    if (!this.config.adaptiveEnabled) return;

    this.pruneWindow();
    const errorRate = this.requestTimestamps.length > 10
      ? this.errorTimestamps.length / this.requestTimestamps.length
      : 0;

    if (errorRate > this.config.adaptiveErrorThreshold) {
      this.adaptiveOverride = true;
      this.adaptiveUntil = originalDateNow() + 30_000; // 30 seconds of full sampling
    }
  }

  private pruneWindow(): void {
    const cutoff = originalDateNow() - this.windowSize;
    this.requestTimestamps = this.requestTimestamps.filter(t => t > cutoff);
    this.errorTimestamps = this.errorTimestamps.filter(t => t > cutoff);
  }
}
