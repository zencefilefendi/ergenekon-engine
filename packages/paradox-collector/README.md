# @ergenekon/collector

> ERGENEKON recording collector — receives, orders, and stores distributed system recordings

[![npm](https://img.shields.io/npm/v/@ergenekon/collector)](https://www.npmjs.com/package/@ergenekon/collector)
[![License](https://img.shields.io/badge/license-BSL%201.1-orange)]()

Lightweight HTTP server that receives recording sessions from `@ergenekon/probe` instances, assembles distributed traces using Hybrid Logical Clock ordering, and stores them for replay and inspection.

## Install

```bash
npm install @ergenekon/collector
```

## Start the Collector

```typescript
import { CollectorServer } from '@ergenekon/collector';

const collector = new CollectorServer({
  port: 4380,
  storageDir: './.ergenekon-recordings',
});

await collector.start();
// [ERGENEKON COLLECTOR] Listening on port 4380
```

Or via CLI:

```bash
npx ergenekon-collector --port 4380 --dir ./.ergenekon-recordings
```

## REST API

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/v1/sessions` | Receive sessions from probes |
| `GET` | `/api/v1/sessions` | List all sessions (summary) |
| `GET` | `/api/v1/sessions/:id` | Get full session with all events |
| `GET` | `/api/v1/traces/:traceId` | Get all sessions for a distributed trace |
| `GET` | `/api/v1/stats` | Collector statistics |
| `GET` | `/health` | Health check |

## Storage

File-based JSON storage — one file per session. In-memory index for fast lookups. Rebuilt from disk on startup.

```
.ergenekon-recordings/
  sessions/
    01HWXYZ...json    ← each recording session
```

Future: Content-Addressable Storage (CAS) with deduplication, delta compression, S3 backend.

## Part of ERGENEKON Engine

| Package | Description |
|---------|-------------|
| `@ergenekon/core` | Shared types, HLC clock, ULID |
| `@ergenekon/probe` | Express middleware — records every request |
| **`@ergenekon/collector`** | ← You are here |
| `@ergenekon/replay` | Replay engine — deterministic re-execution |
| `@ergenekon/cli` | CLI — inspect, export, watch recordings |

## License

Business Source License 1.1 — free for non-production use.
