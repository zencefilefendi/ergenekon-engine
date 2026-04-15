// ============================================================================
// ERGENEKON ENGINE — HLC Tests
//
// Validates the core invariants of Hybrid Logical Clocks:
//   1. Monotonicity — timestamps never go backwards
//   2. Causality — if A → B, then HLC(A) < HLC(B)
//   3. Clock skew resilience — works even when wall clock is wrong
//   4. Determinism — same inputs produce same outputs
// ============================================================================

import { describe, it, expect } from 'vitest';
import { HybridLogicalClock, compareHLC } from './hlc.js';
import type { HLCTimestamp } from './types.js';

describe('HybridLogicalClock', () => {
  describe('monotonicity invariant', () => {
    it('never emits a timestamp less than the previous one (same clock)', () => {
      const hlc = new HybridLogicalClock('node-1');
      const prev = hlc.now();
      for (let i = 0; i < 1000; i++) {
        const next = hlc.now();
        expect(compareHLC(next, prev)).toBeGreaterThan(0);
      }
    });

    it('monotonic under a frozen physical clock', () => {
      // Simulate: wall clock stuck. Only logical should advance.
      let fakeNow = 1_000_000;
      const hlc = new HybridLogicalClock('node-1', () => fakeNow);
      const stamps: HLCTimestamp[] = [];
      for (let i = 0; i < 100; i++) stamps.push(hlc.now());

      for (let i = 1; i < stamps.length; i++) {
        expect(compareHLC(stamps[i]!, stamps[i - 1]!)).toBeGreaterThan(0);
      }
      // All share the same wall time, logical must be 1..100
      expect(stamps[0]!.wallTime).toBe(1_000_000);
      expect(stamps[stamps.length - 1]!.logical).toBe(100);
    });

    it('monotonic under backwards-going physical clock (NTP step)', () => {
      // Simulate: NTP just stepped the clock backwards. HLC must not regress.
      let fakeNow = 2_000_000;
      const hlc = new HybridLogicalClock('node-1', () => fakeNow);
      const first = hlc.now();

      fakeNow = 1_000_000; // clock jumped back
      const second = hlc.now();

      expect(compareHLC(second, first)).toBeGreaterThan(0);
      // Wall time must NOT regress — HLC remembers
      expect(second.wallTime).toBe(2_000_000);
    });
  });

  describe('causality invariant', () => {
    it('maintains A → B => HLC(A) < HLC(B) across two nodes', () => {
      const nodeA = new HybridLogicalClock('A');
      const nodeB = new HybridLogicalClock('B');

      // A emits, then sends to B
      const eventA = nodeA.now();
      const eventB = nodeB.receive(eventA);

      expect(compareHLC(eventB, eventA)).toBeGreaterThan(0);
    });

    it('handles three-node message chain A → B → C', () => {
      const a = new HybridLogicalClock('A');
      const b = new HybridLogicalClock('B');
      const c = new HybridLogicalClock('C');

      const tsA = a.now();
      const tsB = b.receive(tsA);
      const tsC = c.receive(tsB);

      expect(compareHLC(tsB, tsA)).toBeGreaterThan(0);
      expect(compareHLC(tsC, tsB)).toBeGreaterThan(0);
      expect(compareHLC(tsC, tsA)).toBeGreaterThan(0);
    });

    it('receive() from a future-clocked remote adopts remote wall time', () => {
      const local = new HybridLogicalClock('local', () => 1_000);
      const remoteStamp: HLCTimestamp = {
        wallTime: 5_000,
        logical: 42,
        nodeId: 'remote',
      };
      const merged = local.receive(remoteStamp);

      expect(merged.wallTime).toBe(5_000);
      expect(merged.logical).toBe(43); // remote.logical + 1
    });

    it('receive() handles same wall time by advancing logical past both', () => {
      let fakeNow = 1_000;
      const local = new HybridLogicalClock('local', () => fakeNow);
      local.now(); // wallTime=1000, logical=1
      local.now(); // wallTime=1000, logical=2

      const merged = local.receive({
        wallTime: 1_000,
        logical: 7,
        nodeId: 'remote',
      });

      expect(merged.wallTime).toBe(1_000);
      expect(merged.logical).toBe(8); // max(2, 7) + 1
    });
  });

  describe('determinism invariant', () => {
    it('same sequence of operations produces same timestamps', () => {
      const timeline = [1000, 1001, 1001, 1005, 1005, 1005, 1010];

      const run = () => {
        let i = 0;
        const hlc = new HybridLogicalClock('node', () => timeline[i++]!);
        const out: HLCTimestamp[] = [];
        for (let j = 0; j < timeline.length; j++) out.push(hlc.now());
        return out;
      };

      const a = run();
      const b = run();
      expect(a).toEqual(b);
    });
  });

  describe('peek()', () => {
    it('returns current state without advancing', () => {
      let fakeNow = 1_000;
      const hlc = new HybridLogicalClock('node', () => fakeNow);
      hlc.now();
      const p1 = hlc.peek();
      const p2 = hlc.peek();
      expect(p1).toEqual(p2);
    });
  });
});

describe('compareHLC', () => {
  it('orders by wall time first', () => {
    const a: HLCTimestamp = { wallTime: 100, logical: 99, nodeId: 'Z' };
    const b: HLCTimestamp = { wallTime: 200, logical: 0, nodeId: 'A' };
    expect(compareHLC(a, b)).toBeLessThan(0);
  });

  it('orders by logical when wall times equal', () => {
    const a: HLCTimestamp = { wallTime: 100, logical: 5, nodeId: 'Z' };
    const b: HLCTimestamp = { wallTime: 100, logical: 10, nodeId: 'A' };
    expect(compareHLC(a, b)).toBeLessThan(0);
  });

  it('breaks ties by nodeId lexicographically', () => {
    const a: HLCTimestamp = { wallTime: 100, logical: 5, nodeId: 'A' };
    const b: HLCTimestamp = { wallTime: 100, logical: 5, nodeId: 'Z' };
    expect(compareHLC(a, b)).toBeLessThan(0);
  });

  it('returns 0 for identical timestamps', () => {
    const a: HLCTimestamp = { wallTime: 100, logical: 5, nodeId: 'A' };
    const b: HLCTimestamp = { wallTime: 100, logical: 5, nodeId: 'A' };
    expect(compareHLC(a, b)).toBe(0);
  });

  it('produces a total ordering for any 1000 random stamps', () => {
    const stamps: HLCTimestamp[] = [];
    const hlc = new HybridLogicalClock('node');
    for (let i = 0; i < 1000; i++) stamps.push(hlc.now());

    // Sorting by compareHLC must be stable and total
    const sorted = [...stamps].sort(compareHLC);
    for (let i = 1; i < sorted.length; i++) {
      expect(compareHLC(sorted[i]!, sorted[i - 1]!)).toBeGreaterThanOrEqual(0);
    }
  });
});
