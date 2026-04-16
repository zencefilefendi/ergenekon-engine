# @ergenekon/probe

> Zero-config Express middleware for recording production requests — time-travel debugging for distributed systems

[![npm](https://img.shields.io/npm/v/@ergenekon/probe)](https://www.npmjs.com/package/@ergenekon/probe)
[![License](https://img.shields.io/badge/license-BSL%201.1-orange)]()

Drop-in Express middleware that records every request with full deterministic replay capability. Captures HTTP, database queries, Date.now(), Math.random(), timers, crypto — everything needed to reproduce any bug on your laptop.

## Install

```bash
npm install @ergenekon/probe
```

## Quick Start

```typescript
import express from 'express';
import { ErgenekonProbe } from '@ergenekon/probe';

const app = express();
const probe = new ErgenekonProbe({
  serviceName: 'my-service',
  collectorUrl: 'http://localhost:4380',
});

app.use(probe.middleware()); // That's it.
```

## Smart Sampling

Default config records errors always, new routes always, and 1% of everything else:

```typescript
const probe = new ErgenekonProbe({
  serviceName: 'my-service',
  collectorUrl: 'http://localhost:4380',
  sampling: {
    baseRate: 0.01,              // 1% random sampling
    latencyThresholdMs: 500,     // Always record slow requests (>500ms)
    sampleNewPaths: true,        // Always record first time seeing a route
    alwaysSampleErrors: true,    // Always record 5xx errors
    adaptiveEnabled: true,       // Auto-escalate to 100% on error spike
    adaptiveErrorThreshold: 0.05 // Trigger at 5% error rate
  }
});
```

### Tail-Based Sampling

ERGENEKON uses **tail-based** sampling — buffers events and decides at request END. This means errors are **never missed**, even if the HEAD decision said "don't record."

## Deep Redaction

Sensitive fields are automatically redacted before recording:

```typescript
const probe = new ErgenekonProbe({
  serviceName: 'my-service',
  collectorUrl: 'http://localhost:4380',
  redactHeaders: ['authorization', 'cookie', 'x-api-key'],
  redactFields: ['password', 'creditCard', 'ssn'],
});
```

Auto-detected and redacted without configuration:
- JWTs (`eyJ...`)
- Credit card numbers
- Bearer tokens
- AWS access keys
- PEM private keys

## What Gets Intercepted

| Event | Description |
|-------|-------------|
| `http_request_in` | Incoming request (method, path, headers, body) |
| `http_response_out` | Outgoing response (status, headers, body) |
| `http_request_out` | Outgoing fetch() calls |
| `http_response_in` | Responses from downstream services |
| `db_query` / `db_result` | PostgreSQL, Redis, MongoDB queries |
| `timestamp` | Every `Date.now()` call |
| `random` | Every `Math.random()` call |
| `uuid` | Every `crypto.randomUUID()` call |
| `timer_set` / `timer_fire` | setTimeout / setInterval |
| `error` | Uncaught exceptions |
| `console` | console.log/warn/error output |

## Auto-Detection

Database drivers are auto-detected — no config required:

```typescript
// Just have them installed — probe detects automatically:
import pg from 'pg';      // PostgreSQL
import Redis from 'ioredis'; // Redis
import mongoose from 'mongoose'; // MongoDB
```

## Local Mode (Development)

```typescript
const probe = new ErgenekonProbe({ serviceName: 'dev' })
  .enableLocalMode(); // No collector needed

// After requests:
const recordings = probe.getRecordings();
```

## Runtime Control

```typescript
probe.setSamplingRate(0.5);      // Change rate live
probe.setEnabled(false);          // Pause recording
probe.forceRecord(10);            // Force-record next 10 requests
const stats = probe.getSamplingStats(); // { errorRate, adaptiveActive, ... }
await probe.shutdown();           // Flush and stop
```

## Distributed Tracing

Automatically propagates W3C `traceparent` headers between services. Cross-service requests are linked by `traceId` — visible in the ERGENEKON UI as a distributed trace.

## Part of ERGENEKON Engine

| Package | Description |
|---------|-------------|
| `@ergenekon/core` | Shared types, HLC clock, ULID |
| **`@ergenekon/probe`** | ← You are here |
| `@ergenekon/collector` | Ingestion server — stores recordings |
| `@ergenekon/replay` | Replay engine — deterministic re-execution |
| `@ergenekon/cli` | CLI — inspect, export, watch recordings |

## License

Business Source License 1.1 — free for non-production use.
Commercial license available at [ergenekon.dev](https://ergenekon.dev).
