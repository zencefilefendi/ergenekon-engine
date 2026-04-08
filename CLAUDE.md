# PARADOX Engine — Development Guide

## Project Overview
PARADOX is a deterministic record & replay engine for distributed systems.
It enables time-travel debugging of production incidents by recording all I/O boundaries
and replaying them deterministically on a developer's machine.

**Status**: Phase 0 COMPLETED. Phase 1 in progress.

## Repository Structure
```
Yutpa/
├── CLAUDE.md                  # This file — dev guide and conventions
├── README.md                  # Project overview + proof of concept results
├── package.json               # Monorepo root (npm workspaces)
├── tsconfig.base.json         # Shared TypeScript config
├── docs/
│   ├── VISION.md              # Why we exist, target audience, market
│   ├── ARCHITECTURE.md        # Technical architecture deep dive
│   ├── TECHNICAL_DEEP_DIVE.md # Algorithms, data structures, theory
│   ├── ROADMAP.md             # Phase-based development plan
│   └── BUSINESS_MODEL.md      # Pricing, GTM, financials
├── packages/
│   ├── paradox-core/          # Shared types, HLC, ULID (NO dependencies)
│   │   └── src/
│   │       ├── types.ts       # ParadoxEvent, RecordingSession, ProbeConfig
│   │       ├── hlc.ts         # Hybrid Logical Clock implementation
│   │       ├── ulid.ts        # Time-sortable unique ID generator
│   │       └── index.ts       # Public API exports
│   ├── paradox-probe/         # Node.js recording middleware
│   │   └── src/
│   │       ├── index.ts       # ParadoxProbe class (main entry)
│   │       ├── recording-context.ts  # AsyncLocalStorage session management
│   │       ├── internal-clock.ts     # Original Date.now/Math.random refs
│   │       ├── interceptors/
│   │       │   ├── globals.ts        # Date.now, Math.random monkey-patch
│   │       │   ├── http-incoming.ts  # Express middleware (req/res capture)
│   │       │   └── http-outgoing.ts  # fetch() monkey-patch
│   │       └── transport/
│   │           └── collector-client.ts # Buffered send to collector
│   ├── paradox-collector/     # Event collection & storage server
│   │   └── src/
│   │       ├── index.ts       # Entry point + CLI
│   │       ├── server.ts      # HTTP REST API server
│   │       └── storage.ts     # File-based session storage
│   ├── paradox-replay/        # Deterministic replay engine
│   │   └── src/
│   │       ├── index.ts       # Public API exports
│   │       ├── mock-layer.ts  # Mock I/O (replays recorded values)
│   │       └── replay-engine.ts # Orchestrator + timeline inspection
│   └── paradox-ui/            # (PLANNED) Time-travel visual debugger
└── demo/
    ├── app.ts                 # Full demo: Express + Collector + routes
    └── replay-demo.ts         # Self-contained record → replay → verify
```

## Key Technical Decisions

### Architecture
- **Monorepo** with npm workspaces, all packages in `packages/`
- **ESM modules** throughout (`"type": "module"` in all package.json)
- **TypeScript strict mode** for all packages
- Dev-time runs via `tsx` (no build step needed during development)

### Probe Design
- Monkey-patching for zero-config integration (`Date.now`, `Math.random`, `fetch`)
- `AsyncLocalStorage` propagates recording context through async chains
- **Re-entrancy guard** (`_recording` flag) prevents infinite recursion
- `internal-clock.ts` captures original `Date.now.bind(Date)` before any patching
- HLC constructor accepts custom `getPhysicalTime` to avoid patched clock

### Storage (Current: Phase 0)
- File-based JSON storage (one file per session)
- In-memory index rebuilt on startup
- Future: Content-Addressable Storage with deduplication

### Collector
- Plain Node.js HTTP server (no framework dependency)
- REST API: POST /api/v1/sessions, GET /api/v1/sessions, etc.
- Future: gRPC for high-throughput, Rust rewrite

## Critical Invariants
1. **NEVER call `Date.now()` or `Math.random()` inside recording logic** — use `originalDateNow()` from `internal-clock.ts`
2. All I/O intercepts MUST be reversible (clean uninstall via `uninstall*` functions)
3. Every interceptor MUST handle the "not recording" case with ZERO overhead
4. Replay correctness > performance — NEVER sacrifice determinism
5. The `_recording` flag MUST wrap every `session.record()` call in interceptors

## Running
```bash
npm install                       # Install all workspace deps
npx tsx demo/replay-demo.ts       # Quick proof: record → replay → verify
npx tsx demo/app.ts               # Full demo server on :3000 + collector on :4380
```

## What's Been Proven (Phase 0)
- Date.now() deterministic replay ✓
- Math.random() deterministic replay ✓
- HTTP request/response capture ✓
- AsyncLocalStorage context propagation ✓
- HLC timestamp generation ✓
- 23 events captured and replayed with BYTE-FOR-BYTE identical results ✓

## Current Focus: Phase 1
- PostgreSQL driver intercept (pg)
- Redis driver intercept (ioredis)
- setTimeout/setInterval intercept
- crypto.randomUUID() intercept
- Error capture (uncaughtException, unhandledRejection)
- Sensitive data masking improvements
