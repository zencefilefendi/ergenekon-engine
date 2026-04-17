// ============================================================================
// ERGENEKON ENGINE — Hybrid Logical Clock
//
// Provides globally-ordered timestamps for distributed events
// without requiring synchronized physical clocks.
//
// Based on: "Logical Physical Clocks and Consistent Snapshots
// in Globally Distributed Databases" (Kulkarni et al., 2014)
// ============================================================================

import type { HLCTimestamp } from './types.js';

// Capture the ORIGINAL Date.now before any monkey-patching occurs.
// This is critical — HLC must use the real clock, not the intercepted one.
const _rawDateNow = Date.now.bind(Date);

// SECURITY (CRIT-08): Cap logical counter to prevent 2^53 overflow
const MAX_LOGICAL = Number.MAX_SAFE_INTEGER - 1;
// SECURITY: Max acceptable wall-time drift from remote nodes (1 hour)
const MAX_DRIFT_MS = 60 * 60 * 1000;

export class HybridLogicalClock {
  private wallTime: number;
  private logical: number;
  private readonly nodeId: string;
  private readonly getPhysicalTime: () => number;

  constructor(nodeId: string, getPhysicalTime?: () => number) {
    this.nodeId = nodeId;
    this.getPhysicalTime = getPhysicalTime ?? _rawDateNow;
    this.wallTime = this.getPhysicalTime();
    this.logical = 0;
  }

  /**
   * Generate a timestamp for a local event.
   *
   * Algorithm:
   * 1. If physical clock advanced past our wallTime → reset logical counter
   * 2. Otherwise → increment logical counter
   */
  now(): HLCTimestamp {
    const physicalNow = this.getPhysicalTime();

    if (physicalNow > this.wallTime) {
      this.wallTime = physicalNow;
      this.logical = 0;
    } else {
      this.logical++;
      // SECURITY (CRIT-08): Overflow guard
      if (this.logical >= MAX_LOGICAL) {
        throw new Error(`[ERGENEKON] HLC logical counter overflow at ${this.logical}. Clock is stuck.`);
      }
    }

    return {
      wallTime: this.wallTime,
      logical: this.logical,
      nodeId: this.nodeId,
    };
  }

  /**
   * Generate a timestamp upon receiving a message from another node.
   *
   * Merges our clock with the remote clock to maintain causal ordering:
   * if A → B (A causally precedes B), then HLC(A) < HLC(B).
   */
  receive(remote: HLCTimestamp): HLCTimestamp {
    const physicalNow = this.getPhysicalTime();

    // SECURITY (CRIT-08): Reject remote timestamps that are too far in the future
    // This prevents a malicious node from advancing our clock arbitrarily
    const maxAcceptable = physicalNow + MAX_DRIFT_MS;
    const safeRemoteWall = Math.min(remote.wallTime, maxAcceptable);
    const safeRemoteLogical = Math.min(remote.logical, MAX_LOGICAL);

    if (physicalNow > this.wallTime && physicalNow > safeRemoteWall) {
      this.wallTime = physicalNow;
      this.logical = 0;
    } else if (this.wallTime === safeRemoteWall) {
      this.logical = Math.max(this.logical, safeRemoteLogical) + 1;
    } else if (safeRemoteWall > this.wallTime) {
      this.wallTime = safeRemoteWall;
      this.logical = safeRemoteLogical + 1;
    } else {
      this.logical++;
    }

    // SECURITY (CRIT-08): Overflow guard
    if (this.logical >= MAX_LOGICAL) {
      this.logical = 0;
      this.wallTime = physicalNow;
    }

    return {
      wallTime: this.wallTime,
      logical: this.logical,
      nodeId: this.nodeId,
    };
  }

  /** Get current clock state without advancing */
  peek(): HLCTimestamp {
    return {
      wallTime: this.wallTime,
      logical: this.logical,
      nodeId: this.nodeId,
    };
  }
}

/**
 * Compare two HLC timestamps for total ordering.
 * Returns negative if a < b, positive if a > b, zero if equal.
 */
export function compareHLC(a: HLCTimestamp, b: HLCTimestamp): number {
  if (a.wallTime !== b.wallTime) return a.wallTime - b.wallTime;
  if (a.logical !== b.logical) return a.logical - b.logical;
  return a.nodeId.localeCompare(b.nodeId);
}
