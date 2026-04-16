<p align="center">
  <strong>🐺 ERGENEKON</strong>
</p>

<h3 align="center">The Black Box for Software</h3>

<p align="center">
  Record production requests. Replay them on your laptop. Byte-for-byte identical.
</p>

<p align="center">
  <a href="https://ergenekon.dev"><img src="https://img.shields.io/badge/website-ergenekon.dev-6366f1" alt="Website"></a>
  <a href="https://www.npmjs.com/package/@ergenekon/core"><img src="https://img.shields.io/npm/v/@ergenekon/core?label=%40ergenekon%2Fcore&color=10b981" alt="npm"></a>
  <a href="#"><img src="https://img.shields.io/badge/tests-213%20passing-brightgreen" alt="Tests"></a>
  <a href="#"><img src="https://img.shields.io/badge/node-%E2%89%A518-blue" alt="Node"></a>
  <a href="#"><img src="https://img.shields.io/badge/typescript-strict-blue" alt="TypeScript"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-BSL%201.1-orange" alt="License"></a>
</p>

<p align="center">
  <a href="https://ergenekon.dev">Website</a> · 
  <a href="https://ergenekon.dev/docs.html">Docs</a> · 
  <a href="https://ergenekon-dashboard.vercel.app">Live Demo</a> ·
  <a href="https://ergenekon.dev/#pricing">Get Free Trial</a>
</p>

---

## The Problem

Modern distributed systems are impossible to debug:

- A request touches **10+ microservices**. Something breaks. Where?
- Logs give you millions of lines — no context, no state
- Traces show timing — but **not data**
- You spend hours reproducing. Most of the time, **you can't**

| Tool | What it does | What it can't |
|------|-------------|---------------|
| Datadog | Observability (logs, traces) | No replay — no state |
| Sentry | Catch errors | Can't show *how* you got there |
| Jaeger | Distributed tracing | Timing only — no data |
| rr | Process record/replay | Single machine only |
| Replay.io | Browser record/replay | Frontend only |

**Nobody can replay a distributed production bug. ERGENEKON does.**

---

## How It Works

```
Incoming Request
     │
     ▼
┌─────────────────────────────────────────────────┐
│  YOUR SERVICE + ERGENEKON PROBE                 │
│                                                 │
│  Records every I/O boundary:                    │
│  • HTTP in/out  • Database queries  • Timers    │
│  • Date.now()   • Math.random()     • UUIDs     │
│  • File system  • DNS lookups       • Errors    │
│                                                 │
│  3 lines of code. Zero config.                  │
└───────────────────────┬─────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  COLLECTOR       │      ┌──────────────────┐
              │  Stores sessions │ ───▶ │  TIME-TRAVEL UI  │
              │  SHA-256 + fsync │      │  Visual debugger │
              └───────┬──────────┘      └──────────────────┘
                      │
                      ▼
              ┌──────────────────┐
              │  REPLAY ENGINE   │
              │                  │
              │  Loads recording │
              │  Mocks all I/O   │
              │  Re-executes     │
              │  Verifies output │
              │                  │
              │  ✅ IDENTICAL    │
              └──────────────────┘
```

---

## Quick Start

### 1. Install

```bash
npm install @ergenekon/probe @ergenekon/collector
```

### 2. Get a free license (90-day trial, no credit card)

→ [ergenekon.dev/#pricing](https://ergenekon.dev/#pricing)

```bash
mv ~/Downloads/.ergenekon-license.json ./
```

### 3. Add 3 lines to your Express app

```typescript
import { ErgenekonProbe } from '@ergenekon/probe';

const probe = new ErgenekonProbe({
  serviceName: 'checkout-service',
  collectorUrl: 'http://localhost:4380',
});

app.use(probe.middleware()); // Must be first middleware
```

### 4. Start the collector and make a request

```bash
npx ergenekon-collector              # Start collector
curl http://localhost:3000/api/orders # This request is now recorded
npx ergenekon replay <session-id>    # Replay it — byte-for-byte identical
```

---

## Packages

| Package | Version | Description |
|---------|---------|-------------|
| [`@ergenekon/core`](https://www.npmjs.com/package/@ergenekon/core) | v0.4.1 | Types, HLC clock, ULID, session I/O |
| [`@ergenekon/probe`](https://www.npmjs.com/package/@ergenekon/probe) | v0.4.1 | Express middleware — 15 interceptors, sampling, redaction |
| [`@ergenekon/collector`](https://www.npmjs.com/package/@ergenekon/collector) | v0.4.1 | HTTP ingestion server with durable storage |
| [`@ergenekon/replay`](https://www.npmjs.com/package/@ergenekon/replay) | v0.4.1 | Deterministic replay engine |
| [`@ergenekon/cli`](https://www.npmjs.com/package/@ergenekon/cli) | v0.4.1 | 10-command CLI: sessions, inspect, replay, export |
| [`@ergenekon/ui`](https://www.npmjs.com/package/@ergenekon/ui) | v0.4.1 | Time-travel visual debugger |

---

## What Gets Captured

| Interceptor | What | Tier |
|-------------|------|------|
| `http_request_in` | Incoming HTTP requests | Community |
| `http_request_out` | Outgoing fetch/HTTP calls | Community |
| `timestamp` | `Date.now()`, `new Date()`, `performance.now()` | Community |
| `random` | `Math.random()` | Community |
| `timer` | `setTimeout` / `setInterval` | Community |
| `error` | Uncaught exceptions | Community |
| `db_query` | PostgreSQL, MySQL, MongoDB | Pro |
| `fs_operation` | File system reads/writes | Pro |
| `dns_lookup` | DNS resolution | Pro |
| `uuid` | `crypto.randomUUID()` | Pro |

---

## CLI

```bash
ergenekon sessions              # List all recorded sessions
ergenekon inspect <id>          # Detailed session inspection
ergenekon timeline <id>         # ASCII event timeline
ergenekon trace <traceId>       # Distributed trace view
ergenekon replay <id>           # Replay and verify
ergenekon export <id> out.prdx  # Binary export (gzip + CRC32)
ergenekon import data.prdx      # Import a session
ergenekon watch                 # Live recording monitor
ergenekon stats                 # Collector statistics
ergenekon health                # Health check
```

---

## Pricing

| | Community | Pro | Enterprise |
|--|-----------|-----|------------|
| **Price** | Free forever | $49/dev/mo | $199/dev/mo |
| **Trial** | — | 90 days free | 90 days free |
| Services | 1 | Unlimited | Unlimited |
| Retention | 24h | 30 days | Unlimited |
| Replay | Single service | Distributed | Distributed |
| Sampling | — | Smart sampling | Smart sampling |
| Redaction | — | Deep PII redaction | Deep PII redaction |
| Support | Community | Email | Dedicated + SLA |
| SSO/RBAC | — | — | ✅ |

→ **[Start your 90-day free trial](https://ergenekon.dev/#pricing)** — no credit card required.

---

## Architecture

```
packages/
├── ergenekon-core/       # Shared types, HLC clock, ULID, license validation
├── ergenekon-probe/      # Express middleware — 15 interceptors
│   └── interceptors/     # HTTP, DB, fs, DNS, timers, crypto, globals
├── ergenekon-collector/  # HTTP ingestion + file storage
├── ergenekon-replay/     # Deterministic replay engine
├── ergenekon-cli/        # Terminal tool (10 commands)
└── ergenekon-ui/         # React time-travel visual debugger
```

### Key Design Decisions

- **Monorepo** with npm workspaces
- **ESM modules** (`"type": "module"`) — modern Node.js
- **TypeScript strict mode** across all packages
- **Zero dependencies** in core (only `@types/node`)
- **Monkey-patching** for zero-config integration
- **AsyncLocalStorage** for request context propagation
- **HLC timestamps** for distributed event ordering
- **Ed25519 signatures** for tamper-proof licenses

---

## Deployment

### Docker

```bash
docker-compose up
```

### Kubernetes (Helm)

```bash
helm install ergenekon ./helm/ergenekon
```

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ERGENEKON_COLLECTOR_URL` | `http://localhost:4380` | Collector endpoint |
| `ERGENEKON_LICENSE_KEY` | — | License JSON (inline) |
| `ERGENEKON_LICENSE` | — | License file path |
| `ERGENEKON_COLLECTOR_PORT` | `4380` | Collector listen port |
| `ERGENEKON_DATA_DIR` | `./recordings` | Storage directory |

---

## Security

We take security seriously. See [SECURITY.md](SECURITY.md) for our vulnerability disclosure policy.

- **Ed25519** asymmetric license signatures
- **HSTS** with preload on all endpoints
- **Rate limiting** (global + per-IP + per-email)
- **Input sanitization** on all API endpoints
- **No secrets in git history** (audited + scrubbed)

---

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) for development setup and coding standards.

```bash
git clone https://github.com/zencefilefendi/ergenekon-engine.git
cd ergenekon-engine
npm install
npm run build
npm test        # 213 tests, 14 files — all passing
```

---

## License

[Business Source License 1.1](LICENSE) — free for non-production use. Production use requires a [license](https://ergenekon.dev/#pricing).

After 4 years, the code converts to Apache 2.0.

---

<p align="center">
  Built by <a href="https://github.com/zencefilefendi">İlhan Göktaş</a> · 
  <a href="https://ergenekon.dev">ergenekon.dev</a>
</p>
