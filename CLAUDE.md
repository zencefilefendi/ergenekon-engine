# PARADOX Engine — Development Guide

## Project Overview
PARADOX is a deterministic record & replay engine for distributed systems.
It enables time-travel debugging of production incidents by recording all I/O boundaries
and replaying them deterministically on a developer's machine.

**Status**: Phase 0 ✅ Phase 1 ✅ Phase 2 ✅ Phase 3 ✅ Phase 4 ✅ — npm publish ready. Phase 5 (Scale & Launch) next.

## Repository Structure
```
Yutpa/
├── CLAUDE.md                  # This file — dev guide and conventions
├── README.md                  # Project overview + proof of concept results
├── package.json               # Monorepo root (npm workspaces)
├── tsconfig.base.json         # Shared TypeScript config
├── docs/
│   ├── VISION.md              # Why we exist, target audience, market, milestones
│   ├── ARCHITECTURE.md        # Package details, data flow, design decisions (ADRs)
│   ├── TOPOLOGY.md            # System topology, port map, deployment scenarios
│   ├── TECHNICAL_DEEP_DIVE.md # HLC, replay theory, sampling, redaction, PRDX format
│   ├── ROADMAP.md             # Phase-based development plan (Phase 0-5)
│   ├── BUSINESS_MODEL.md      # Pricing, GTM, financials, risk analysis
│   └── CONTRIBUTING.md        # Dev environment setup, coding standards, PR process
├── packages/
│   ├── paradox-core/          # Shared types, HLC, ULID (NO dependencies)
│   │   └── src/
│   │       ├── types.ts       # ParadoxEvent, RecordingSession, ProbeConfig
│   │       ├── hlc.ts         # Hybrid Logical Clock implementation
│   │       ├── ulid.ts        # Time-sortable unique ID generator
│   │       ├── session-io.ts  # Session export/import (JSON + PRDX binary)
│   │       └── index.ts       # Public API exports
│   ├── paradox-probe/         # Node.js recording middleware
│   │   └── src/
│   │       ├── index.ts       # ParadoxProbe class (main entry)
│   │       ├── recording-context.ts  # AsyncLocalStorage session management
│   │       ├── internal-clock.ts     # Original Date.now/Math.random refs
│   │       ├── sampling.ts           # Smart sampling engine (head+tail hybrid)
│   │       ├── redaction.ts          # Deep field redaction (PII, secrets)
│   │       ├── benchmark.ts          # Performance overhead micro-benchmark
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
│   ├── paradox-cli/           # CLI tool (10 commands, ANSI output)
│   │   └── src/
│   │       └── index.ts       # CLI entry point + command router
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

# CLI tool
npx tsx packages/paradox-cli/src/index.ts sessions   # List recorded sessions
npx tsx packages/paradox-cli/src/index.ts inspect <id> # Inspect a session
npx tsx packages/paradox-cli/src/index.ts timeline <id> # View event timeline
npx tsx packages/paradox-cli/src/index.ts export <id>   # Export session (JSON/PRDX)
npx tsx packages/paradox-cli/src/index.ts health       # Collector health check
```

## What's Been Proven (Phase 0)
- Date.now() deterministic replay ✓
- Math.random() deterministic replay ✓
- HTTP request/response capture ✓
- AsyncLocalStorage context propagation ✓
- HLC timestamp generation ✓
- 23 events captured and replayed with BYTE-FOR-BYTE identical results ✓

## What's Been Proven (Phase 1)
- PostgreSQL/Redis/MongoDB driver intercept (auto-detection) ✓
- setTimeout/setInterval timing capture ✓
- crypto.randomUUID() capture ✓
- Error + Console capture ✓
- Multi-service distributed recording (98 events, 2 services) ✓
- Cross-service trace context propagation ✓

## What's Been Proven (Phase 2)
- Time-Travel Web UI (visual debugger) ✓
- Cross-service session assembly ✓
- Interactive timeline scrubber ✓
- Service flow visualization ✓

## What's Been Proven (Phase 3)
- Smart Sampling Engine: head+tail hybrid, 6 reasons (error, latency, new_path, upstream, adaptive, random) ✓
- Adaptive auto-escalation + path normalization ✓
- Deep Field Redaction: recursive walking, glob paths, auto-detect (JWT, credit cards, Bearer, AWS keys, private keys) ✓
- Session Export/Import: JSON + binary PRDX format (magic header, gzip, CRC32), ~24% compression ✓
- CLI Tool: 10 commands (sessions, inspect, timeline, trace, export, import, stats, watch, health, help) ✓
- Performance Benchmark: micro-benchmark for overhead measurement ✓

## Current Focus: Phase 4
- Production-Ready hardening
- Delta compression + CAS deduplication
- Tiered storage (memory → disk → S3)
- Kubernetes operator + Helm chart
- CI/CD pipeline + load testing
