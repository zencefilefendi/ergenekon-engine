# @paradox/collector

> PARADOX recording collector — receives, orders, and stores distributed system recordings

[![npm](https://img.shields.io/npm/v/@paradox/collector)](https://www.npmjs.com/package/@paradox/collector)
[![License](https://img.shields.io/badge/license-BSL%201.1-orange)]()

Lightweight HTTP server that receives recording sessions from `@paradox/probe` instances, assembles distributed traces using Hybrid Logical Clock ordering, and stores them for replay and inspection.

## Install

```bash
npm install @paradox/collector
```

## Start the Collector

```typescript
import { CollectorServer } from '@paradox/collector';

const collector = new CollectorServer({
  port: 4380,
  storageDir: './.paradox-recordings',
});

await collector.start();
// [PARADOX COLLECTOR] Listening on port 4380
```

Or via CLI:

```bash
npx paradox-collector --port 4380 --dir ./.paradox-recordings
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
.paradox-recordings/
  sessions/
    01HWXYZ...json    ← each recording session
```

Future: Content-Addressable Storage (CAS) with deduplication, delta compression, S3 backend.

## Part of PARADOX Engine

| Package | Description |
|---------|-------------|
| `@paradox/core` | Shared types, HLC clock, ULID |
| `@paradox/probe` | Express middleware — records every request |
| **`@paradox/collector`** | ← You are here |
| `@paradox/replay` | Replay engine — deterministic re-execution |
| `@paradox/cli` | CLI — inspect, export, watch recordings |

## License

Business Source License 1.1 — free for non-production use.
