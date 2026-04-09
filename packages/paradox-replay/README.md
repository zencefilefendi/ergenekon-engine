# @paradox/replay

> Deterministic replay engine — reproduce any production bug on your laptop, byte-for-byte identical

[![npm](https://img.shields.io/npm/v/@paradox/replay)](https://www.npmjs.com/package/@paradox/replay)
[![License](https://img.shields.io/badge/license-BSL%201.1-orange)]()

Takes a recording from `@paradox/collector` and re-executes it with all I/O mocked to return the exact same values as production. Every `Date.now()`, `Math.random()`, database result, and HTTP response is replayed in sequence — guaranteed byte-for-byte identical output.

## Install

```bash
npm install @paradox/replay
```

## Replay a Recording

```typescript
import { ReplayEngine } from '@paradox/replay';

const engine = new ReplayEngine(session);

// Replay with mocked I/O — pass your handler function
const result = await engine.replay(async (mocks) => {
  // mocks.mockDateNow()     → returns recorded Date.now() value
  // mocks.mockMathRandom()  → returns recorded Math.random() value
  // mocks.mockFetch(url)    → returns recorded HTTP response
  // mocks.mockDbQuery(sql)  → returns recorded DB result
  return yourHandler();
});
```

## Time-Travel Inspection

```typescript
const engine = new ReplayEngine(session);

// Get the full event timeline
const timeline = engine.getTimeline();
// [{ sequence, type, operationName, durationMs, ... }, ...]

// Get system state at any point in time
const state = engine.getStateAt(42); // sequence 42
// { dateNowValues, randomValues, dbQueries, httpCalls }

// Diff between two points
const diff = engine.getDiff(10, 50);
// { added: [...], removed: [...], changed: [...] }
```

## Proven Results

```
━━━ VERIFICATION ━━━━━━━━━━━━━━━━━━━━━━
  PERFECT REPLAY — BYTE-FOR-BYTE IDENTICAL

  Original requestId:  57wbkit6
  Replayed requestId:  57wbkit6  ✓
  Original score:      68
  Replayed score:      68        ✓

  Date.now()     → deterministic ✓
  Math.random()  → deterministic ✓
  Response body  → identical     ✓
```

## Why It Works

Node.js is single-threaded — no thread scheduling non-determinism. By capturing all I/O boundary values and replaying them in the same order, execution is fully deterministic.

**Non-determinism sources captured:**
- `Date.now()` — wall clock
- `Math.random()` — PRNG
- `crypto.randomUUID()` — random bytes
- Database results — external state
- HTTP responses — external services
- Timer fire order — async scheduling

## Part of PARADOX Engine

| Package | Description |
|---------|-------------|
| `@paradox/core` | Shared types, HLC clock, ULID |
| `@paradox/probe` | Express middleware — records every request |
| `@paradox/collector` | Ingestion server — stores recordings |
| **`@paradox/replay`** | ← You are here |
| `@paradox/cli` | CLI — inspect, export, watch recordings |

## License

Business Source License 1.1 — free for non-production use.
