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

## Phase 1: Real I/O (Hafta 3-4) ← BURADASIN

### Hedef: Gercek uygulamalarda kullanilabilir probe

- [ ] PostgreSQL intercept (pg driver monkey-patch)
- [ ] Redis intercept (ioredis monkey-patch)
- [ ] MongoDB intercept (mongoose/mongodb driver)
- [ ] setTimeout/setInterval intercept
- [ ] crypto.randomUUID() intercept
- [ ] Error capture (uncaughtException, unhandledRejection)
- [ ] Hassas veri maskeleme iyilestirmesi (body field masking)
- [ ] Console.log/warn/error capture
- [ ] Event batching optimizasyonu
- [ ] Multi-service demo (2 Express servisi konusuyor)

### Basari Kriteri
Gercek bir microservice uygulamasini (Express + PostgreSQL + Redis)
kaydet ve birebir replay et.

---

## Phase 2: Distributed (Hafta 5-8)

### Hedef: Multi-service record/replay

- [ ] W3C Trace Context propagation (zaten temel var, genislet)
- [ ] Cross-service session assembly (collector'da birlestir)
- [ ] Multi-service replay orchestration
- [ ] Rust Collector v0.1
  - [ ] gRPC ingestion (yuksek throughput)
  - [ ] HLC validation + global ordering
  - [ ] File-based CAS storage
- [ ] Web UI v0.1
  - [ ] Session listesi + arama
  - [ ] Event timeline (interaktif)
  - [ ] Service flow diagram (servisler arasi akis)
  - [ ] Event detail panel (request/response/state)

### Basari Kriteri
3 servisten olusan bir sistemi kaydet,
herhangi bir request'i 3 serviste birden replay et.

---

## Phase 3: Time Travel (Hafta 9-12)

### Hedef: Gorsel zaman yolculugu debugger

- [ ] Checkpoint sistemi (her N event'te state snapshot)
- [ ] Zamanda geri gitme (reverse replay via checkpoints)
- [ ] State diff (iki zaman noktasi arasindaki fark)
- [ ] Time Travel UI
  - [ ] Timeline scrubber (surukle-birak)
  - [ ] Interactive service graph (canli akis)
  - [ ] State inspector (degisken degerlerini gor)
  - [ ] Request/response viewer (formatted JSON)
  - [ ] Search + filter (event arama)
- [ ] VS Code extension (temel entegrasyon)

### Basari Kriteri
UI'da bir session ac, timeline'i surukle,
herhangi bir andaki state'i gor.

---

## Phase 4: Production-Ready (Hafta 13-20)

### Hedef: Gercek production'da kullanilabilir

- [ ] Smart sampling (head-based + tail-based hybrid)
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
