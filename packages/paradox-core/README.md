# @ergenekon/core

> Shared types, HLC clock, ULID, and session I/O for ERGENEKON Engine

[![npm](https://img.shields.io/npm/v/@ergenekon/core)](https://www.npmjs.com/package/@ergenekon/core)
[![License](https://img.shields.io/badge/license-BSL%201.1-orange)]()

The zero-dependency foundation of ERGENEKON Engine. Contains all shared types, the Hybrid Logical Clock (HLC) implementation, ULID generator, and session import/export utilities used by all other packages.

## Install

```bash
npm install @ergenekon/core
```

## What's Inside

### Types

```typescript
import type {
  ErgenekonEvent,     // A single captured I/O event
  RecordingSession, // Complete trace of one request
  SessionMetadata,  // Node version, duration, error flag
  HLCTimestamp,     // Hybrid Logical Clock timestamp
  EventType,        // 15 event types (http, db, random, timer...)
  ProbeConfig,      // Probe configuration
  ReplayConfig,     // Replay engine configuration
} from '@ergenekon/core';
```

### Hybrid Logical Clock

Causally-ordered timestamps for distributed systems — no NTP required.

```typescript
import { HybridLogicalClock, compareHLC } from '@ergenekon/core';

const hlc = new HybridLogicalClock('service-a');
const ts1 = hlc.now();          // { wallTime, logical, nodeId }
const ts2 = hlc.receive(remote); // Sync with remote clock

// Total ordering across services
compareHLC(ts1, ts2); // -1 | 0 | 1
```

### ULID

Time-sortable unique IDs with zero dependencies.

```typescript
import { ulid } from '@ergenekon/core';

const id = ulid(); // "01HWXYZ..." — sortable, URL-safe
```

### Session Import / Export

```typescript
import {
  exportSessionJSON,
  exportSessionBinary,
  importSessionsJSON,
  importSessionBinary,
} from '@ergenekon/core';

// JSON export (human-readable)
const json = exportSessionJSON(session, { pretty: true });

// Binary export — PRDX format with gzip + CRC32 (~24% smaller)
const buf = exportSessionBinary(session);
const restored = importSessionBinary(buf);
```

## Part of ERGENEKON Engine

| Package | Description |
|---------|-------------|
| **`@ergenekon/core`** | ← You are here |
| `@ergenekon/probe` | Express middleware — records every request |
| `@ergenekon/collector` | Ingestion server — stores recordings |
| `@ergenekon/replay` | Replay engine — deterministic re-execution |
| `@ergenekon/cli` | CLI — inspect, export, watch recordings |

## License

Business Source License 1.1 — free for non-production use.
Commercial license available at [paradox.dev](https://paradox.dev).
