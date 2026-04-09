# @paradox/cli

> PARADOX CLI — inspect, export, and live-watch distributed system recordings from your terminal

[![npm](https://img.shields.io/npm/v/@paradox/cli)](https://www.npmjs.com/package/@paradox/cli)
[![License](https://img.shields.io/badge/license-BSL%201.1-orange)]()

A beautiful ANSI-colored CLI for working with PARADOX recordings. List sessions, inspect event timelines, visualize distributed traces, export to binary format, and live-tail new recordings — all without leaving your terminal.

## Install

```bash
npm install -g @paradox/cli
# or use npx
npx @paradox/cli sessions
```

## Commands

```
paradox sessions               List all recorded sessions
paradox inspect <sessionId>    Show detailed session info + event breakdown
paradox timeline <sessionId>   Print ASCII event timeline with timing
paradox trace <traceId>        Visualize distributed trace across services
paradox export <id> [file]     Export session (.json or .paradox.bin)
paradox import <file>          Import session into collector
paradox stats                  Show collector statistics
paradox watch                  Live-tail new recordings (polls every 2s)
paradox health                 Check collector connectivity
paradox help                   Show help
```

## Examples

```bash
# List all sessions
paradox sessions

# 📼 Recorded Sessions (32)
# ID                           Service            Events   Duration   Error  Time
# ─────────────────────────────────────────────────────────────────────────────
# 01HWXYZ...                   order-service      59       23ms       ✓      4/9/2026...

# Inspect a session
paradox inspect 01HWXYZ...

# ⏱ Timeline — see exactly when each event fired
paradox timeline 01HWXYZ...

#   000   +0ms  ● http_request_in      POST /api/orders
#   001   +1ms  ● timestamp            Date.now()
#   002   +1ms  ● random               Math.random()
#   003   +2ms  ● http_request_out     GET http://user-svc/api/users/1
#   004  +18ms  ● http_response_in     200 GET http://user-svc/api/users/1
#   005  +19ms  ● db_query             SELECT * FROM orders WHERE ...
#   ...

# See distributed trace across 2 services
paradox trace abc123def456...

# 🔗 Distributed Trace
#   order-service    ╠══════════════╣ 23ms (59 events)
#   user-service       ╠═════╣ 8ms (21 events)

# Export to compact binary
paradox export 01HWXYZ... recording.paradox.bin
# ✓ Exported (420 bytes, 24% smaller than JSON)

# Live-tail new recordings
paradox watch
# 👀 Watching for new recordings...
#   NEW 12:35:48 order-service — 59 events, 23ms
#   NEW 12:35:49 user-service — 21 events, 8ms
```

## Configuration

```bash
# Point to a non-default collector
PARADOX_COLLECTOR_URL=http://staging:4380 paradox sessions
```

## Part of PARADOX Engine

| Package | Description |
|---------|-------------|
| `@paradox/core` | Shared types, HLC clock, ULID |
| `@paradox/probe` | Express middleware — records every request |
| `@paradox/collector` | Ingestion server — stores recordings |
| `@paradox/replay` | Replay engine — deterministic re-execution |
| **`@paradox/cli`** | ← You are here |

## License

Business Source License 1.1 — free for non-production use.
