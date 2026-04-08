# PARADOX Engine — Yol Haritasi

## Phase 0: Foundation (Hafta 1-2) ✅ TAMAMLANDI

### Hedef: Calisir bir proof-of-concept

- [x] Proje yapisini olustur (monorepo, TypeScript, npm workspaces)
- [x] Temel event schema'yi tanimla (TypeScript interfaces)
- [x] Node.js Probe v0.1
  - [x] HTTP incoming intercept (Express middleware)
  - [x] HTTP outgoing intercept (fetch monkey-patch)
  - [x] Date.now() intercept
  - [x] Math.random() intercept
  - [x] AsyncLocalStorage ile context propagation
  - [x] In-memory event buffer + collector client
- [x] Collector v0.1 (TypeScript)
  - [x] HTTP ingestion endpoint (REST API)
  - [x] Session assembly (trace ID ile gruplama)
  - [x] Dosya-tabanli storage (JSON)
  - [x] Session listeleme + sorgulama API
- [x] Replay Engine v0.1
  - [x] Recording yukleme (file + in-memory)
  - [x] Mock layer (Date.now, Math.random, fetch)
  - [x] Timeline inspection (time-travel data)
  - [x] State-at-point-in-time sorgulama
- [x] Demo: Express app + probe → kaydet → replay et → BIREBIR ayni sonuc
- [x] Re-entrancy guard (sonsuz dongu problemi cozuldu)
- [x] Internal clock isolation (HLC + ULID icin)

### Basari Kriteri ✅ KARSILANDI
23 event (Date.now, Math.random, HTTP) yakalanip
BYTE-FOR-BYTE ayni sonuc replay edildi.

### Cozulen Muhendislik Zorluklar
1. **Re-entrancy**: `record()` → `ulid()` → `Date.now()` → `record()` sonsuz dongu → `_recording` flag
2. **Circular import**: `globals.ts` ↔ `recording-context.ts` → `internal-clock.ts` ile kopardi
3. **Clock isolation**: HLC patched `Date.now` goruyordu → raw ref capture at module load

---

## Phase 1: Real I/O (Hafta 3-4) ✅ TAMAMLANDI

### Hedef: Gercek uygulamalarda kullanilabilir probe

- [x] PostgreSQL intercept (pg Client.query + Pool.query monkey-patch)
- [x] Redis intercept (ioredis sendCommand)
- [x] MongoDB intercept (mongoose Collection methods)
- [x] setTimeout/setInterval intercept (set + fire correlation)
- [x] crypto.randomUUID() intercept
- [x] Error capture (uncaughtException, unhandledRejection)
- [x] Console.log/warn/error capture (level + args)
- [x] Auto-detection: probe otomatik olarak mevcut DB driver'lari bulur
- [x] Multi-service demo (Order Service → User Service, 98 event, 2 servis)
- [x] Replay mock layer genisletildi (DB, Redis, Timer, UUID, Console, Error)

### Basari Kriteri
Gercek bir microservice uygulamasini (Express + PostgreSQL + Redis)
kaydet ve birebir replay et.

---

## Phase 2: Distributed + Time-Travel UI (Hafta 5-8) ✅ TAMAMLANDI

### Hedef: Gorsel zaman yolculugu debugger + distributed replay

- [x] W3C Trace Context propagation (zaten temel var, genislet)
- [x] Cross-service session assembly (collector'da birlestir)
- [x] Multi-service replay orchestration
- [x] Web UI v0.1
  - [x] Session listesi + arama
  - [x] Event timeline (interaktif)
  - [x] Service flow diagram (servisler arasi akis)
  - [x] Event detail panel (request/response/state)

### Basari Kriteri ✅ KARSILANDI
3 servisten olusan bir sistemi kaydet,
herhangi bir request'i 3 serviste birden replay et.

---

## Phase 3: Production Essentials (Hafta 9-12) ✅ TAMAMLANDI

### Hedef: Production'a hazirlik icin sampling, redaction, CLI ve export/import

- [x] Smart Sampling Engine (`paradox-probe/src/sampling.ts`)
  - [x] Head+tail hybrid sampling
  - [x] 6 sampling reason: error, latency, new_path, upstream, adaptive, random
  - [x] Adaptive auto-escalation (hata oranina gore otomatik artis)
  - [x] Path normalization (URL parametrelerini normalize et)
- [x] Deep Field Redaction (`paradox-probe/src/redaction.ts`)
  - [x] Recursive object walking (ic ice nesnelerde alan tarama)
  - [x] Field name matching (alan adi eslesme)
  - [x] Glob path patterns (joker karakter desenleri)
  - [x] Auto-detect: JWT, credit cards, Bearer tokens, AWS keys, private keys
- [x] Session Export/Import (`paradox-core/src/session-io.ts`)
  - [x] JSON format export/import
  - [x] Binary PRDX format (magic header, gzip compression, CRC32 checksum)
  - [x] ~24% compression orani
- [x] CLI Tool (`paradox-cli/`)
  - [x] 10 komut: sessions, inspect, timeline, trace, export, import, stats, watch, health, help
  - [x] ANSI renkli cikti
- [x] Performance Benchmark (`paradox-probe/src/benchmark.ts`)
  - [x] Overhead olcumu icin micro-benchmark

### Basari Kriteri ✅ KARSILANDI
Smart sampling calisiyor, PII/secret otomatik maskeleniyor,
session'lar binary formatta export/import edilebiliyor, CLI ile tam yonetim.

---

## Phase 4: Production-Ready (Hafta 13-20) ← BURADASIN

### Hedef: Gercek production'da kullanilabilir

- [ ] Delta compression
- [ ] CAS deduplication
- [ ] Tiered storage (memory → disk → S3)
- [ ] Configurable retention
- [ ] Performance optimization (<%1 overhead)
- [ ] Kubernetes operator
- [ ] Helm chart
- [ ] Docker compose setup
- [ ] CI/CD pipeline
- [ ] Load testing (1M event/sn hedefi)
- [ ] Security audit
- [ ] Documentation site
- [ ] Rust Collector v0.1
  - [ ] gRPC ingestion (yuksek throughput)
  - [ ] HLC validation + global ordering
  - [ ] File-based CAS storage

### Basari Kriteri
1000 RPS alan bir production benzeri ortamda
%1'den az overhead ile calis.

---

## Phase 5: Launch (Hafta 21-24)

### Hedef: Ilk musteriler

- [ ] Landing page + docs site
- [ ] Open source release (Community Edition)
- [ ] Pro plan ozellikleri
- [ ] Managed cloud beta
- [ ] Integration guides (Express, NestJS, Fastify, Koa)
- [ ] Demo video + blog post
- [ ] Product Hunt launch
- [ ] Hacker News post
- [ ] Y Combinator basvurusu

---

## Gelecek Vizyonu (6-12 ay)

- Python probe (Django, FastAPI)
- Go probe
- Java probe (Spring Boot)
- AI-powered root cause analysis
- Collaborative debugging (takim icinde session paylasma)
- Integration: Datadog, Grafana, PagerDuty
- Automatic regression detection
- Chaos engineering integration
