// ============================================================================
// PARADOX COLLECTOR — Token Bucket Rate Limiter
//
// Protects the collector from abuse with per-IP rate limiting.
// Uses a classic token bucket algorithm with automatic cleanup.
//
// Default: 100 requests per minute per IP.
// ============================================================================

export interface RateLimiterConfig {
  /** Maximum tokens (burst capacity) */
  maxTokens: number;
  /** Token refill rate (tokens per second) */
  refillRate: number;
  /** Cleanup interval for stale entries (ms) */
  cleanupIntervalMs: number;
}

const DEFAULT_CONFIG: RateLimiterConfig = {
  maxTokens: 100,
  refillRate: 100 / 60,  // 100 per minute
  cleanupIntervalMs: 60_000,
};

interface Bucket {
  tokens: number;
  lastRefill: number;
}

export class RateLimiter {
  private readonly config: RateLimiterConfig;
  private readonly buckets = new Map<string, Bucket>();
  private cleanupTimer: NodeJS.Timeout | null = null;

  constructor(config: Partial<RateLimiterConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.startCleanup();
  }

  /**
   * Try to consume a token for the given key (IP address).
   * Returns true if allowed, false if rate limited.
   */
  consume(key: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(key);

    if (!bucket) {
      bucket = { tokens: this.config.maxTokens, lastRefill: now };
      this.buckets.set(key, bucket);
    }

    // Refill tokens based on elapsed time
    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.config.maxTokens,
      bucket.tokens + elapsed * this.config.refillRate,
    );
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return true;
    }

    return false;
  }

  /** Get remaining tokens for a key */
  remaining(key: string): number {
    const bucket = this.buckets.get(key);
    return bucket ? Math.floor(bucket.tokens) : this.config.maxTokens;
  }

  /** Clean up stale entries older than 2x cleanup interval */
  private startCleanup(): void {
    this.cleanupTimer = setInterval(() => {
      const cutoff = Date.now() - this.config.cleanupIntervalMs * 2;
      for (const [key, bucket] of this.buckets) {
        if (bucket.lastRefill < cutoff) {
          this.buckets.delete(key);
        }
      }
    }, this.config.cleanupIntervalMs);

    // Don't prevent process exit
    if (this.cleanupTimer.unref) {
      this.cleanupTimer.unref();
    }
  }

  /** Stop the cleanup timer */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
    this.buckets.clear();
  }
}
