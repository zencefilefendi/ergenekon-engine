# PARADOX Engine — Yol Haritasi

## Phase 0: Foundation (Hafta 1-2) ← BURADASIN

### Hedef: Calisir bir proof-of-concept

- [ ] Proje yapisini olustur (monorepo, TypeScript + Rust)
- [ ] Temel event schema'yi tanimla (protobuf)
- [ ] Node.js Probe v0.1
  - [ ] HTTP incoming intercept (Express middleware)
  - [ ] HTTP outgoing intercept (fetch monkey-patch)
  - [ ] Date.now() intercept
  - [ ] Math.random() intercept
  - [ ] AsyncLocalStorage ile context propagation
  - [ ] In-memory event buffer
- [ ] In-Memory Collector v0.1
  - [ ] Event ingestion (HTTP endpoint)
  - [ ] Session assembly (trace ID ile gruplama)
  - [ ] Basit dosya-tabanli storage
- [ ] Replay Engine v0.1
  - [ ] Recording yukleme
  - [ ] Mock layer (HTTP, Date, Random)
  - [ ] Basit CLI replay (node replay.js --session=xxx)
- [ ] Demo: Express app + probe → kaydet → replay et → ayni sonuc

### Basari Kriteri
Bir Express uygulamasinda bir request'i kaydet,
replay et, ve birebir ayni sonucu al.

---

## Phase 1: Real I/O (Hafta 3-4)

### Hedef: Gercek uygulamalarda kullanilabilir probe

- [ ] PostgreSQL intercept (pg driver)
- [ ] Redis intercept (ioredis)
- [ ] MongoDB intercept (mongoose)
- [ ] axios/node-fetch intercept
- [ ] setTimeout/setInterval intercept
- [ ] crypto.randomUUID() intercept
- [ ] Error capture (uncaughtException, unhandledRejection)
- [ ] Sensitive data masking (headers, body fields)
- [ ] Event batching + async flush
- [ ] npm paketi olarak yayinla (@paradox/probe)

### Basari Kriteri
Gercek bir microservice uygulamasini (Express + PostgreSQL + Redis)
kaydet ve birebir replay et.

---

## Phase 2: Distributed (Hafta 5-8)

### Hedef: Multi-service record/replay

- [ ] W3C Trace Context propagation
- [ ] HLC implementation (TypeScript)
- [ ] Cross-service session assembly
- [ ] Multi-service replay orchestration
- [ ] Rust Collector v0.1
  - [ ] gRPC ingestion
  - [ ] HLC validation
  - [ ] File-based CAS storage
- [ ] Basit Web UI v0.1
  - [ ] Session listesi
  - [ ] Event timeline
  - [ ] Service flow diagram
  - [ ] Event detail panel

### Basari Kriteri
3 servisten olusan bir sistemi kaydet,
herhangi bir request'i 3 serviste birden replay et.

---

## Phase 3: Time Travel (Hafta 9-12)

### Hedef: Gorsel zaman yolculugu debugger

- [ ] Checkpoint sistemi (her N event'te snapshot)
- [ ] Zamanda geri gitme (reverse replay)
- [ ] State diff (iki zaman noktasi arasindaki fark)
- [ ] Time Travel UI
  - [ ] Timeline scrubber
  - [ ] Interactive service graph
  - [ ] State inspector
  - [ ] Request/response viewer
  - [ ] Search + filter
- [ ] VS Code extension (temel)

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
- [ ] Documentation

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
- [ ] Integration guides (Express, NestJS, Fastify)
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
