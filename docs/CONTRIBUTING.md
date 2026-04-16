# Contributing to ERGENEKON Engine

Thank you for your interest in contributing! This guide covers everything you need to get started.

## Development Setup

### Prerequisites

- Node.js ≥ 18
- npm ≥ 9

### Clone & Install

```bash
git clone https://github.com/zencefilefendi/ergenekon-engine.git
cd ergenekon-engine
npm install
```

### Build

```bash
npm run build     # Build all packages
```

### Test

```bash
npm test          # Run all 213 tests
```

### Run Demos

```bash
npx tsx demo/replay-demo.ts         # Quick: record → replay → verify
npx tsx demo/app.ts                 # Full server on :3000 + collector on :4380
npx tsx demo/multi-service-demo.ts  # Multi-service distributed recording
```

---

## Project Structure

```
packages/
├── ergenekon-core/       # Shared types, HLC, ULID (zero dependencies)
├── ergenekon-probe/      # Express middleware + 15 interceptors
├── ergenekon-collector/  # HTTP ingestion + storage server
├── ergenekon-replay/     # Deterministic replay engine
├── ergenekon-cli/        # 10-command CLI tool
└── ergenekon-ui/         # Time-travel visual debugger
```

---

## Coding Standards

- **TypeScript strict mode** — no `any`, no `@ts-ignore`
- **ESM modules** — `import`/`export` only
- **Meaningful names** — no single-letter variables
- **Tests required** — every feature needs test coverage
- **No console.log** in library code — use structured logging
- **Zero dependencies** policy for `@ergenekon/core`

---

## Pull Request Process

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes with tests
4. Run `npm test` — all 213+ tests must pass
5. Run `npm run build` — must compile cleanly
6. Submit a PR with a clear description

### Commit Convention

```
feat: add new interceptor for WebSocket
fix: correct HLC drift calculation
docs: update CLI reference
test: add edge case for redaction engine
perf: optimize event batching
security: add CSP headers
```

---

## Architecture Notes

### Critical Invariants

1. **NEVER** call `Date.now()` or `Math.random()` inside recording logic — use `originalDateNow()` from `internal-clock.ts`
2. All interceptors **MUST** be reversible (clean uninstall)
3. Every interceptor **MUST** handle the "not recording" case with zero overhead
4. Replay correctness > performance — **NEVER** sacrifice determinism
5. The `_recording` re-entrancy guard **MUST** wrap every `session.record()` call

### Adding a New Interceptor

1. Create `packages/ergenekon-probe/src/interceptors/my-interceptor.ts`
2. Export `installMyInterceptor()` and `uninstallMyInterceptor()`
3. Wire into `ErgenekonProbe.start()` and `stop()`
4. Add event type to `ErgenekonEvent` in core types
5. Add replay mock in `packages/ergenekon-replay/src/mock-layer.ts`
6. Write tests covering record AND replay paths

---

## License

By contributing, you agree that your contributions will be licensed under the [BSL 1.1](../LICENSE).
