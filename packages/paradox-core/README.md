# @paradox/core

> Shared types, HLC clock, ULID, and session I/O for PARADOX Engine

[![npm](https://img.shields.io/npm/v/@paradox/core)](https://www.npmjs.com/package/@paradox/core)
[![License](https://img.shields.io/badge/license-BSL%201.1-orange)]()

The zero-dependency foundation of PARADOX Engine. Contains all shared types, the Hybrid Logical Clock (HLC) implementation, ULID generator, and session import/export utilities used by all other packages.

## Install

```bash
npm install @paradox/core
```

## What's Inside

### Types

```typescript
import type {
  ParadoxEvent,     // A single captured I/O event
  RecordingSession, // Complete trace of one request
  SessionMetadata,  // Node version, duration, error flag
  HLCTimestamp,     // Hybrid Logical Clock timestamp
  EventType,        // 15 event types (http, db, random, timer...)
  ProbeConfig,      // Probe configuration
  ReplayConfig,     // Replay engine configuration
} from '@paradox/core';
```

### Hybrid Logical Clock

Causally-ordered timestamps for distributed systems — no NTP required.

```typescript
import { HybridLogicalClock, compareHLC } from '@paradox/core';

const hlc = new HybridLogicalClock('service-a');
const ts1 = hlc.now();          // { wallTime, logical, nodeId }
const ts2 = hlc.receive(remote); // Sync with remote clock

// Total ordering across services
compareHLC(ts1, ts2); // -1 | 0 | 1
```

### ULID

Time-sortable unique IDs with zero dependencies.

```typescript
import { ulid } from '@paradox/core';

const id = ulid(); // "01HWXYZ..." — sortable, URL-safe
```

### Session Import / Export

```typescript
import {
  exportSessionJSON,
  exportSessionBinary,
  importSessionsJSON,
  importSessionBinary,
} from '@paradox/core';

// JSON export (human-readable)
const json = exportSessionJSON(session, { pretty: true });

// Binary export — PRDX format with gzip + CRC32 (~24% smaller)
const buf = exportSessionBinary(session);
const restored = importSessionBinary(buf);
```

## Part of PARADOX Engine

| Package | Description |
|---------|-------------|
| **`@paradox/core`** | ← You are here |
| `@paradox/probe` | Express middleware — records every request |
| `@paradox/collector` | Ingestion server — stores recordings |
| `@paradox/replay` | Replay engine — deterministic re-execution |
| `@paradox/cli` | CLI — inspect, export, watch recordings |

## License

Business Source License 1.1 — free for non-production use.
Commercial license available at [paradox.dev](https://paradox.dev).
