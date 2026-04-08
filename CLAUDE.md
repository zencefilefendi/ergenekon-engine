# PARADOX Engine — Development Guide

## Project Overview
PARADOX is a deterministic record & replay engine for distributed systems.
It enables time-travel debugging of production incidents by recording all I/O boundaries
and replaying them deterministically on a developer's machine.

## Repository Structure
```
Yutpa/
├── CLAUDE.md              # This file
├── README.md              # Project overview
├── docs/
│   ├── VISION.md          # Why we exist, target audience, market
│   ├── ARCHITECTURE.md    # Technical architecture deep dive
│   ├── TECHNICAL_DEEP_DIVE.md  # Algorithms, data structures, theory
│   ├── ROADMAP.md         # Phase-based development plan
│   └── BUSINESS_MODEL.md  # Pricing, GTM, financials
├── packages/
│   ├── paradox-probe/     # Node.js recording middleware
│   ├── paradox-collector/ # Event collection & storage (Rust)
│   ├── paradox-replay/    # Deterministic replay engine
│   └── paradox-ui/        # Time-travel visual debugger (React)
```

## Key Technical Decisions
- **Probe language**: TypeScript (Node.js monkey-patching for I/O intercept)
- **Collector language**: Rust (high throughput, low latency)
- **Event ordering**: Hybrid Logical Clocks (HLC) for distributed ordering
- **Storage**: Content-Addressable Storage (CAS) with deduplication
- **Protocol**: Protobuf for event schema, gRPC for collector communication
- **UI**: React + D3.js for time-travel visualization

## Development Conventions
- Monorepo with packages/ directory
- TypeScript strict mode for all TS packages
- Event schema defined in protobuf (single source of truth)
- All I/O intercepts must be reversible (clean uninstall)
- Every interceptor must handle the "not recording" case with zero overhead
- Replay correctness > performance (never sacrifice determinism)

## Current Phase: Phase 0 — Foundation
Focus: Working proof-of-concept with Express.js HTTP record/replay
