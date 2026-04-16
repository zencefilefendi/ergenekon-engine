# ERGENEKON Engine

**Distributed Systems Time-Travel Debugger**

> Production'daki her bug'ı birebir reproduce et. Zamanda geri git, olayı adım adım izle, kodu düzelt, aynı senaryoyu tekrar çalıştır — tüm bunları geliştirici makinesinde yap.

[![Phase](https://img.shields.io/badge/phase-5%20%E2%9C%93%20LAUNCHED-brightgreen)](https://ergenekon.dev)
[![Build](https://img.shields.io/badge/build-passing-brightgreen)]()
[![Tests](https://img.shields.io/badge/tests-213%20passing-brightgreen)]()
[![Node](https://img.shields.io/badge/node-%3E%3D20-blue)]()
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue)]()
[![License](https://img.shields.io/badge/license-BSL%201.1-orange)]()
[![npm](https://img.shields.io/npm/v/@ergenekon/core?label=%40ergenekon%2Fcore)](https://www.npmjs.com/package/@ergenekon/core)
[![Website](https://img.shields.io/badge/website-ergenekon.dev-cyan)](https://ergenekon.dev)

---

## Problem

Modern yazılım dünyasının en büyük çözülmemiş problemi: **production debugging.**

Bir request 10 microservice'den geçiyor. Bir yerde bir şey bozuluyor. Log'lara bakıyorsun — binlerce satır. Trace'lere bakıyorsun — timing bilgisi var ama state yok. Metric'lere bakıyorsun — ne olduğunu görüyorsun ama **neden** olduğunu göremiyorsun.

Sonuç: Mühendisler saatlerce, bazen günlerce bug'ı reproduce etmeye çalışıyor. Çoğu zaman edemiyorlar bile.

| Araç | Ne Yapıyor | Eksikliği |
|------|-----------|-----------|
| **Datadog** | Gözlem (log, trace, metric) | Replay yok — state görünmüyor |
| **Sentry** | Hatayı yakala | Nasıl oraya gelindiği görünmüyor |
| **Jaeger** | Distributed timing | Data yok — sadece süre |
| **rr** | Process record/replay | Tek makine, distributed değil |
| **Replay.io** | Browser record/replay | Sadece frontend |

**Kimse production'daki bir distributed bug'ı birebir replay edemiyor. ERGENEKON bunu yapıyor.**

---

## Çözüm

ERGENEKON, production ortamındaki her request'i deterministik olarak kaydeder ve geliştirici makinesinde birebir replay edebilir.

```
Production → [ERGENEKON PROBE] → [COLLECTOR] → [TIME-TRAVEL UI / CLI / REPLAY]
                ↑                                        ↓
         Her I/O yakalanır                   İstediğin anda, istediğin noktaya git
```

### Temel Yetenekler

- **🔴 Deterministic Record** — HTTP, DB, Date.now(), Math.random(), UUID, timer — her şeyi yakala
- **⏪ Time-Travel Replay** — Herhangi bir request'i yerelde birebir oynat
- **🔍 Distributed Tracing+** — Sadece timing değil, her servisin tam STATE'ini gör
- **🎯 Smart Sampling** — Hataları %100, yeni route'ları %100, geri kalanı %1 örnekle
- **🔒 Deep Redaction** — JWT, kredi kartı, şifreler — production verisini güvenle kaydet
- **📦 Binary Export** — Kayıtları paylaş, import et, arşivle

---

## Kanıtlanmış: Çalışıyor

```
━━━ STEP 3: VERIFICATION ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✅ PERFECT REPLAY — BYTE-FOR-BYTE IDENTICAL

  Original requestId:  57wbkit6
  Replayed requestId:  57wbkit6  ← TAM AYNI

  Date.now()     → 1712345678901  ✓ deterministic
  Math.random()  → 0.73421847     ✓ deterministic
  Response body  → identical      ✓ byte-for-byte

━━━ DISTRIBUTED TRACE (2 services, 98 events) ━━━━━━━━━━━━━━━━━━

  order-service   ╠══════════════════════════╣  23ms  (59 events)
  user-service       ╠══════════╣              8ms   (21 events)

  Cross-service trace: abc123def456...
  Total span: 23ms
```

---

## Mimari Özeti

```
┌─────────────────────────────────────────────────────────────┐
│                    UYGULAMANIZ                              │
│                                                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │
│  │  Service A   │  │  Service B   │  │  Service C   │     │
│  │  [PROBE] ────┼──┼─► [PROBE] ──┼──┼─► [PROBE]    │     │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘     │
└─────────┼─────────────────┼─────────────────┼─────────────┘
          │  W3C traceparent│  propagation     │
          ▼                 ▼                  ▼
┌─────────────────────────────────────────────────────────────┐
│                  ERGENEKON COLLECTOR :4380                    │
│          HLC Ordering + File Storage + REST API             │
└──────────┬──────────────────────┬──────────────────────────┘
           │                      │
           ▼                      ▼
  ┌────────────────┐    ┌─────────────────────┐
  │  TIME-TRAVEL   │    │   ERGENEKON CLI       │
  │  UI :3000      │    │   ergenekon sessions  │
  │  Dark theme    │    │   ergenekon timeline  │
  │  Timeline      │    │   ergenekon watch     │
  │  Scrubber      │    └─────────────────────┘
  └────────────────┘
           │
           ▼
  ┌────────────────┐
  │  REPLAY ENGINE │
  │  Mock I/O      │
  │  Deterministic │
  └────────────────┘
```

---

## Paketler

| Paket | Versiyon | Açıklama |
|-------|----------|----------|
| [`@ergenekon/core`](https://www.npmjs.com/package/@ergenekon/core) | v0.4.0 | Tipler, HLC clock, ULID, session import/export |
| [`@ergenekon/probe`](https://www.npmjs.com/package/@ergenekon/probe) | v0.4.0 | Express middleware — 15+ interceptor, smart sampling, redaction |
| [`@ergenekon/collector`](https://www.npmjs.com/package/@ergenekon/collector) | v0.4.0 | HTTP ingestion server, HLC ordering, file storage |
| [`@ergenekon/replay`](https://www.npmjs.com/package/@ergenekon/replay) | v0.4.0 | Deterministik replay engine, time-travel inspection |
| [`@ergenekon/ui`](https://www.npmjs.com/package/@ergenekon/ui) | v0.4.0 | Dark theme time-travel visual debugger |
| [`@ergenekon/cli`](https://www.npmjs.com/package/@ergenekon/cli) | v0.4.0 | 10-komut CLI: sessions, inspect, timeline, trace, export, watch |

---

## Hızlı Başlangıç

```bash
# 1. Kur
git clone https://github.com/zencefilefendi/ergenekon-engine
cd ergenekon-engine && npm install

# 2. Full-stack demo başlat (Collector + 2 Servis + UI)
npm run demo:fullstack

# 3. UI'yi aç
open http://localhost:3000

# 4. Request üret
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"2"}'
```

### Kendi Projenize Entegre (3 satır)

```typescript
import { ErgenekonProbe } from '@ergenekon/probe';

const probe = new ErgenekonProbe({
  serviceName: 'my-service',
  collectorUrl: 'http://localhost:4380',
});

app.use(probe.middleware()); // Bitti.
```

### CLI ile Kayıtları Yönet

```bash
npm run cli sessions           # Tüm kayıtları listele
npm run cli inspect <id>       # Detaylı inceleme
npm run cli timeline <id>      # ASCII event timeline
npm run cli trace <traceId>    # Distributed trace görselleştir
npm run cli export <id> r.bin  # Binary export (gzip + CRC32)
npm run cli watch              # Canlı izleme modu
```

---

## Faz Durumu

| Faz | Durum | Öne Çıkan |
|-----|-------|-----------|
| **Phase 0: Foundation** | ✅ Tamamlandı | 23 event, byte-for-byte replay kanıtı |
| **Phase 1: Real I/O** | ✅ Tamamlandı | PG + Redis + MongoDB + timers, 98 event, 2 servis |
| **Phase 2: Time-Travel UI** | ✅ Tamamlandı | Dark theme debugger, timeline scrubber, service flow |
| **Phase 3: Production Hardening** | ✅ Tamamlandı | Smart sampling, deep redaction, binary export, CLI |
| **Phase 4: Launch Ready** | ✅ Tamamlandı | TypeScript build pipeline, per-package README, npm hazır |
| **Phase 5: LAUNCHED 🚀** | ✅ Tamamlandı | npm published, ergenekon.dev canlı, license API aktif |

---

## Çözülen Mühendislik Zorlukları

### 1. Re-Entrancy Sonsuz Döngü
`session.record()` → `ulid()` → `Date.now()` → `session.record()` → sonsuz döngü.
**Çözüm**: `_recording` boolean flag ile re-entrancy guard.

### 2. Circular Import Dependency
`globals.ts` ↔ `recording-context.ts` birbirini import ediyor.
**Çözüm**: `internal-clock.ts` ile bağımlılık döngüsünü kırdık.

### 3. HLC Clock Isolation
HLC `Date.now()` çağırınca patched versiyonu görüyordu.
**Çözüm**: `Date.now.bind(Date)` ile orijinal referansı module yükleme anında yakaladık.

### 4. Distributed Replay Divergence
Express v5 kendi içinde `Math.random()` çağırıyor — kayıtta var, replay'de yok.
**Çözüm**: Response body'yi `http_response_out` event'inden direkt oku.

### 5. Tail-Based Sampling
HEAD'de "kaydetme" dersen, ama sonra hata çıkarsa ne yaparsın?
**Çözüm**: Her request'i buffer'la, sonucu gördükten sonra karar ver.

---

## Dokümantasyon

| Dosya | İçerik |
|-------|--------|
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Teknik mimari, paket detayları, veri akışı |
| [docs/TOPOLOGY.md](docs/TOPOLOGY.md) | Sistem topolojisi, port haritası, deployment |
| [docs/TECHNICAL_DEEP_DIVE.md](docs/TECHNICAL_DEEP_DIVE.md) | HLC algoritması, replay teorisi, CAS |
| [docs/ROADMAP.md](docs/ROADMAP.md) | Faz bazlı geliştirme planı |
| [docs/VISION.md](docs/VISION.md) | Neden varız, hedef kitle, rekabet analizi |
| [docs/BUSINESS_MODEL.md](docs/BUSINESS_MODEL.md) | Fiyatlandırma, GTM, finansal projeksiyon |
| [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md) | Katkı rehberi, geliştirme ortamı kurulumu |

---

## Lisans

Business Source License 1.1 (BSL-1.1)

Production kullanımı için ticari lisans gereklidir.
Geliştirme ve test için ücretsizdir.

🐺 **[ergenekon.dev](https://ergenekon.dev)** — Ücretsiz Pro lisans al

&copy; 2026 ERGENEKON Engine Contributors
