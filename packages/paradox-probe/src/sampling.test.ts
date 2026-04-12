// ============================================================================
// PARADOX PROBE — Sampling Engine Tests
//
// Validates:
//   1. Head+tail sampling decisions
//   2. New path detection (race condition fix — Issue 4)
//   3. Error/latency/upstream/adaptive escalation
//   4. Path normalization
//   5. Adaptive sampling triggers
//   6. Stats reporting
//
// INVARIANT: Concurrent requests to the same new path produce AT MOST
//            one "new_path" decision.
// ============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import { SamplingEngine, DEFAULT_SAMPLING_CONFIG } from './sampling.js';

let engine: SamplingEngine;

beforeEach(() => {
  engine = new SamplingEngine();
});

describe('SamplingEngine — headDecision', () => {
  it('records upstream-sampled requests', () => {
    const decision = engine.headDecision({ path: '/api/test', upstreamSampled: true });
    expect(decision.shouldRecord).toBe(true);
    expect(decision.reason).toBe('upstream');
  });

  it('records new paths on first sight', () => {
    const d1 = engine.headDecision({ path: '/api/users' });
    expect(d1.shouldRecord).toBe(true);
    expect(d1.reason).toBe('new_path');

    // Second request to same path — NOT new
    const d2 = engine.headDecision({ path: '/api/users' });
    // Should be random or dropped (baseRate is 0.01, so likely dropped)
    // We can't assert exact reason due to randomness, but it shouldn't be new_path
    expect(d2.reason).not.toBe('new_path');
  });

  it('Issue 4 FIX: concurrent new path requests — only first gets new_path', () => {
    // Simulate N concurrent requests arriving at the same time for a never-seen path
    const decisions = Array.from({ length: 100 }, () =>
      engine.headDecision({ path: '/api/orders' })
    );

    const newPathCount = decisions.filter(d => d.reason === 'new_path').length;
    expect(newPathCount).toBe(1); // Only the FIRST one should be new_path
  });

  it('normalizes paths for dedup (numeric IDs)', () => {
    engine.headDecision({ path: '/api/users/123' }); // new: /api/users/:id
    const d2 = engine.headDecision({ path: '/api/users/456' }); // same normalized
    expect(d2.reason).not.toBe('new_path');
  });

  it('normalizes paths for dedup (hex IDs)', () => {
    engine.headDecision({ path: '/api/sessions/a1b2c3d4e5f6' });
    const d2 = engine.headDecision({ path: '/api/sessions/f6e5d4c3b2a1' });
    expect(d2.reason).not.toBe('new_path');
  });

  it('normalizes paths for dedup (business IDs)', () => {
    engine.headDecision({ path: '/api/orders/ORD-ABC123' });
    const d2 = engine.headDecision({ path: '/api/orders/ORD-XYZ789' });
    expect(d2.reason).not.toBe('new_path');
  });

  it('respects maxTrackedPaths', () => {
    const small = new SamplingEngine({ maxTrackedPaths: 3, baseRate: 0 });
    small.headDecision({ path: '/a' });
    small.headDecision({ path: '/b' });
    small.headDecision({ path: '/c' });
    // 4th new path — maxTrackedPaths reached, still returns new_path but doesn't add
    const d4 = small.headDecision({ path: '/d' });
    expect(d4.shouldRecord).toBe(true);
    expect(d4.reason).toBe('new_path');
    expect(small.getStats().seenPaths).toBe(3);
  });

  it('drops requests at 0% baseRate when path is known', () => {
    const engine0 = new SamplingEngine({ baseRate: 0, sampleNewPaths: false });
    const decisions = Array.from({ length: 100 }, () =>
      engine0.headDecision({ path: '/api/known' })
    );
    expect(decisions.every(d => d.shouldRecord === false)).toBe(true);
    expect(decisions.every(d => d.reason === 'dropped')).toBe(true);
  });

  it('records all requests at 100% baseRate', () => {
    const engine100 = new SamplingEngine({ baseRate: 1.0, sampleNewPaths: false });
    // First call may be new_path, subsequent should be random
    engine100.headDecision({ path: '/warmup' }); // seed seen paths
    const decisions = Array.from({ length: 50 }, () =>
      engine100.headDecision({ path: '/warmup' })
    );
    expect(decisions.every(d => d.shouldRecord === true)).toBe(true);
  });
});

describe('SamplingEngine — tailDecision', () => {
  it('never downgrades a head yes to no', () => {
    const head = engine.headDecision({ path: '/api/new' });
    expect(head.shouldRecord).toBe(true);

    const tail = engine.tailDecision(head, {
      path: '/api/new',
      statusCode: 200,
      durationMs: 10,
      hasError: false,
    });
    expect(tail.shouldRecord).toBe(true);
  });

  it('upgrades to error on 5xx', () => {
    const head = { shouldRecord: false, reason: 'dropped' as const };
    const tail = engine.tailDecision(head, {
      path: '/api/fail',
      statusCode: 500,
      durationMs: 10,
      hasError: false,
    });
    expect(tail.shouldRecord).toBe(true);
    expect(tail.reason).toBe('error');
  });

  it('upgrades to error on hasError', () => {
    const head = { shouldRecord: false, reason: 'dropped' as const };
    const tail = engine.tailDecision(head, {
      path: '/api/fail',
      statusCode: 200,
      durationMs: 10,
      hasError: true,
    });
    expect(tail.shouldRecord).toBe(true);
    expect(tail.reason).toBe('error');
  });

  it('upgrades to latency on slow requests', () => {
    const eng = new SamplingEngine({ latencyThresholdMs: 100 });
    // Warm path so it's not "new"
    eng.headDecision({ path: '/api/slow' });

    const head = { shouldRecord: false, reason: 'dropped' as const };
    const tail = eng.tailDecision(head, {
      path: '/api/slow',
      statusCode: 200,
      durationMs: 200,
      hasError: false,
    });
    expect(tail.shouldRecord).toBe(true);
    expect(tail.reason).toBe('latency');
  });

  it('does not upgrade to latency if under threshold', () => {
    const eng = new SamplingEngine({ latencyThresholdMs: 100 });
    const head = { shouldRecord: false, reason: 'dropped' as const };
    const tail = eng.tailDecision(head, {
      path: '/api/fast',
      statusCode: 200,
      durationMs: 50,
      hasError: false,
    });
    expect(tail.shouldRecord).toBe(false);
  });

  it('tracks request timestamps for stats', () => {
    const eng = new SamplingEngine({ baseRate: 0, sampleNewPaths: false });
    const head = { shouldRecord: false, reason: 'dropped' as const };

    for (let i = 0; i < 10; i++) {
      eng.tailDecision(head, {
        path: '/api/test',
        statusCode: i < 3 ? 500 : 200,
        durationMs: 10,
        hasError: i < 3,
      });
    }

    const stats = eng.getStats();
    expect(stats.recentRequests).toBe(10);
    expect(stats.recentErrors).toBe(3);
    expect(stats.errorRate).toBeCloseTo(0.3, 1);
  });
});

describe('SamplingEngine — adaptive sampling', () => {
  it('triggers adaptive mode on error rate spike', () => {
    const eng = new SamplingEngine({
      adaptiveEnabled: true,
      adaptiveErrorThreshold: 0.05,
      baseRate: 0,
      sampleNewPaths: false,
    });

    const head = { shouldRecord: false, reason: 'dropped' as const };

    // Generate enough errors to trigger (>5% error rate, >10 requests)
    for (let i = 0; i < 15; i++) {
      eng.tailDecision(head, {
        path: '/api/test',
        statusCode: 500,
        durationMs: 10,
        hasError: true,
      });
    }

    const stats = eng.getStats();
    expect(stats.adaptiveActive).toBe(true);
    expect(stats.currentRate).toBe(1.0);
  });

  it('does not trigger adaptive with low error rate', () => {
    const eng = new SamplingEngine({
      adaptiveEnabled: true,
      adaptiveErrorThreshold: 0.05,
    });

    const head = { shouldRecord: false, reason: 'dropped' as const };

    // 100 requests, only 1 error = 1% < 5% threshold
    for (let i = 0; i < 100; i++) {
      eng.tailDecision(head, {
        path: '/api/test',
        statusCode: i === 50 ? 500 : 200,
        durationMs: 10,
        hasError: i === 50,
      });
    }

    expect(eng.getStats().adaptiveActive).toBe(false);
  });
});

describe('SamplingEngine — normalizePath', () => {
  it('replaces numeric path segments', () => {
    expect(engine.normalizePath('/api/users/123')).toBe('/api/users/:id');
  });

  it('replaces hex IDs', () => {
    expect(engine.normalizePath('/api/sessions/a1b2c3d4')).toBe('/api/sessions/:id');
  });

  it('replaces business IDs', () => {
    expect(engine.normalizePath('/api/orders/ORD-ABC123')).toBe('/api/orders/:id');
  });

  it('strips query params', () => {
    expect(engine.normalizePath('/api/search?q=test&page=2')).toBe('/api/search');
  });

  it('handles root path', () => {
    expect(engine.normalizePath('/')).toBe('/');
  });

  it('handles multiple numeric segments', () => {
    expect(engine.normalizePath('/api/users/42/posts/99')).toBe('/api/users/:id/posts/:id');
  });
});

describe('SamplingEngine — config', () => {
  it('uses default config', () => {
    expect(engine.getStats().currentRate).toBe(DEFAULT_SAMPLING_CONFIG.baseRate);
  });

  it('updateConfig merges partial config', () => {
    engine.updateConfig({ baseRate: 0.5 });
    expect(engine.getStats().currentRate).toBe(0.5);
  });

  it('disabling sampleNewPaths skips new path recording', () => {
    const eng = new SamplingEngine({ sampleNewPaths: false, baseRate: 0 });
    const d = eng.headDecision({ path: '/api/brand-new' });
    expect(d.shouldRecord).toBe(false);
    expect(d.reason).toBe('dropped');
  });

  it('disabling honorUpstreamDecision ignores upstream flag', () => {
    const eng = new SamplingEngine({ honorUpstreamDecision: false, baseRate: 0, sampleNewPaths: false });
    const d = eng.headDecision({ path: '/api/test', upstreamSampled: true });
    expect(d.shouldRecord).toBe(false);
  });
});
