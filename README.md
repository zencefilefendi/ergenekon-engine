# PARADOX Engine

**Distributed Systems Time-Travel Debugger**

> Production'da olusan her bug'i birebir tekrar uret, zamanda geri git, ileri sar, kodu degistir, ayni senaryoyu tekrar calistir.

[![Phase](https://img.shields.io/badge/phase-3%20%E2%9C%93%20production%20ready-brightgreen)]()
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue)]()
[![License](https://img.shields.io/badge/license-BSL%201.1-orange)]()
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue)]()

## Problem

Modern yazilim dunyasinin en buyuk cozulmemis problemi: **production debugging.**

Bir request 10 microservice'den geciyor. Bir yerde bir sey bozuluyor. Log'lara bakiyorsun — binlerce satir. Trace'lere bakiyorsun — timing bilgisi var ama state yok. Metric'lere bakiyorsun — ne oldugunu goruyorsun ama NEDEN oldugunu goremiyorsun.

Sonuc: Muhendisler saatlerce, bazen gunlerce bug'i reproduce etmeye calisiyor. Cogu zaman edemiyorlar bile.

**Datadog** gozlem yapar — ama replay yapamaz.
**Sentry** hatayi gorur — ama reproduce edemez.
**Jaeger** timing gorur — ama state goremez.
**rr** tek process kayit eder — ama distributed calismaz.

Kimse production'daki bir distributed bug'i birebir replay edemiyor. **PARADOX bunu yapiyor.**

## Cozum

PARADOX, production ortamindaki her request'i deterministik olarak kaydeder ve gelistirici makinesinde birebir replay edebilir. Bir VCR gibi — ama distributed sistemler icin.

### Temel Yetenekler

- **Deterministic Record**: Tum I/O boundary'lerini (HTTP, DB, time, random) yakala
- **Time-Travel Replay**: Herhangi bir request'i yerelde birebir oynat, zamanda ileri/geri git
- **Distributed Tracing+**: Sadece trace degil, her servisin tam STATE'ini gor
- **Fix Verification**: Kodu degistir, ayni senaryoyu tekrar calistir — fix'in calisiyor mu?
- **Smart Sampling**: Akilli ornekleme ile production overhead'i %1'in altinda tut

## Kanitlanmis: Calisiyor

```
━━━ STEP 3: VERIFICATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  PERFECT REPLAY — Results are BYTE-FOR-BYTE IDENTICAL

  Original requestId:  57wbkit6
  Replayed requestId:  57wbkit6
  Original score:      68
  Replayed score:      68

  Date.now()    → deterministic
  Math.random() → deterministic
  Response body → identical
```

23 event (Date.now, Math.random, HTTP request/response) yakalanip birebir ayni sonuclari uretecek sekilde replay edildi.

## Mimari

```
  Your Application
  ┌──────────┐  ┌──────────┐  ┌──────────┐
  │Service A │  │Service B │  │Service C │
  │ [PROBE]  │  │ [PROBE]  │  │ [PROBE]  │
  └────┬─────┘  └────┬─────┘  └────┬─────┘
       │              │              │
       ▼              ▼              ▼
  ┌─────────────────────────────────────────┐
  │         PARADOX COLLECTOR               │
  │    HLC Ordering + Event Storage         │
  └─────────────┬───────────────────────────┘
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
  ┌────────┐ ┌────────┐ ┌────────┐
  │Storage │ │Replay  │ │Time    │
  │Engine  │ │Engine  │ │Travel  │
  └────────┘ └────────┘ │UI     │
                         └────────┘
```

## Packages

| Paket | Durum | Aciklama |
|-------|-------|----------|
| `@paradox/core` | v0.4 ✓ | Event schema, HLC, ULID, session import/export (JSON + binary) |
| `@paradox/probe` | v0.4 ✓ | Express middleware, smart sampling, deep redaction, 15+ interceptors |
| `@paradox/collector` | v0.4 ✓ | HTTP ingestion server, session assembly, file storage |
| `@paradox/replay` | v0.4 ✓ | Mock I/O layer, deterministic replay engine, timeline inspection |
| `@paradox/ui` | v0.3 ✓ | Dark theme time-travel visual debugger with timeline scrubber |
| `@paradox/cli` | v0.4 ✓ | 10-command CLI: sessions, inspect, timeline, trace, export, watch |

## Hizli Baslangic

```bash
# Repoyu klonla ve bagimliluklari yukle
git clone <repo-url> && cd Yutpa && npm install

# Full-stack demo (Collector + 2 Service + UI)
npx tsx demo/fullstack-demo.ts

# UI'i ac: http://localhost:3000
```

### Probe Entegrasyonu (3 satir)

```typescript
import { ParadoxProbe } from '@paradox/probe';

const probe = new ParadoxProbe({
  serviceName: 'user-service',
  collectorUrl: 'http://localhost:4380',
  sampling: { baseRate: 0.01, adaptiveEnabled: true }, // Smart sampling
});

app.use(probe.middleware());
```

### CLI ile Kayitlari Yonet

```bash
npx paradox sessions           # Tum kayitlari listele
npx paradox inspect <id>       # Detayli inceleme
npx paradox timeline <id>      # ASCII event timeline
npx paradox trace <traceId>    # Distributed trace goster
npx paradox export <id> r.bin  # Binary export (gzip + CRC32)
npx paradox watch              # Canli izleme
```

### Demo Endpoint'leri Test Et

```bash
curl -X POST localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"2"}'
```

## Teknik Detaylar

Detayli dokumantasyon `docs/` dizininde:

- **[VISION.md](docs/VISION.md)** — Neden variz, hedef kitle, rekabet analizi
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** — Paket mimarileri, event schema, intercept stratejisi
- **[TECHNICAL_DEEP_DIVE.md](docs/TECHNICAL_DEEP_DIVE.md)** — HLC, CAS, replay teorisi, sampling
- **[ROADMAP.md](docs/ROADMAP.md)** — Phase bazli gelistirme plani
- **[BUSINESS_MODEL.md](docs/BUSINESS_MODEL.md)** — Fiyatlandirma, GTM, finansal projeksiyon

## Cozulen Muhendislik Zorluklar

### 1. Re-Entrancy Sonsuz Dongu
`session.record()` → `ulid()` → `Date.now()` → `session.record()` → sonsuz dongu.
**Cozum**: `_recording` boolean flag ile re-entrancy guard.

### 2. Circular Import Dependency
`globals.ts` ↔ `recording-context.ts` birbirini import ediyor.
**Cozum**: `internal-clock.ts` modulu ile bagimlilik dongusunu kirdik.

### 3. HLC Clock Isolation
HLC `Date.now()` cagirinca patched versiyonu goruyordu.
**Cozum**: `Date.now.bind(Date)` ile orijinal referansi module yukleme aninda yakaladik.

## Mevcut Durum

| Phase | Durum | Detay |
|-------|-------|-------|
| Phase 0: Foundation | ✅ Tamamlandi | HTTP record/replay, Date/Random intercept, 23 events |
| Phase 1: Real I/O | ✅ Tamamlandi | PG, Redis, Mongo, timers, crypto, errors, multi-service (98 events) |
| Phase 2: Time-Travel UI | ✅ Tamamlandi | Dark theme visual debugger, timeline scrubber, service flow |
| Phase 3: Production Hardening | ✅ Tamamlandi | Smart sampling, deep redaction, binary export, CLI, benchmark |
| Phase 4: Launch | 🔄 Sirada | npm publish, per-package README, open-source release |

## Lisans

Business Source License 1.1 (BSL-1.1)
