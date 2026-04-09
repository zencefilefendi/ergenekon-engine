# PARADOX Engine — Geliştirme Yol Haritası

---

## Phase 0: Foundation ✅ TAMAMLANDI

**Hedef**: Çalışan bir proof-of-concept

### Tamamlananlar
- [x] Monorepo yapısı (npm workspaces, TypeScript strict)
- [x] Core event schema (`ParadoxEvent`, `RecordingSession`, `HLCTimestamp`)
- [x] Hybrid Logical Clock (HLC) implementasyonu
- [x] ULID üretici (sıfır bağımlılık)
- [x] HTTP incoming intercept (Express middleware)
- [x] HTTP outgoing intercept (fetch monkey-patch)
- [x] Date.now() intercept + Math.random() intercept
- [x] AsyncLocalStorage ile context propagation
- [x] Re-entrancy guard (`_recording` flag)
- [x] Internal clock isolation (`internal-clock.ts`)
- [x] File-based storage (JSON, bir dosya per session)
- [x] Replay engine v0.1 (MockLayer + Timeline inspection)
- [x] Demo: Express + Collector + Replay

### Kanıtlanan Başarı ✅
```
23 event → BYTE-FOR-BYTE identik replay

Original requestId:  57wbkit6
Replayed requestId:  57wbkit6  ← TAM AYNI

Date.now()     → deterministic ✓
Math.random()  → deterministic ✓
```

### Çözülen Mühendislik Zorlukları
1. Re-entrancy sonsuz döngü → `_recording` flag
2. Circular import → `internal-clock.ts`
3. HLC clock isolation → raw referans module yükleme anında yakalandı

---

## Phase 1: Real I/O ✅ TAMAMLANDI

**Hedef**: Gerçek uygulamalarda kullanılabilir probe

### Tamamlananlar
- [x] PostgreSQL intercept (`pg.Client.query` + `Pool.query`)
- [x] Redis intercept (`ioredis.sendCommand`)
- [x] MongoDB intercept (`mongoose.Collection` metodları)
- [x] setTimeout / setInterval intercept (set + fire correlation)
- [x] `crypto.randomUUID()` intercept
- [x] Error capture (`uncaughtException`, `unhandledRejection`)
- [x] Console capture (`console.log/warn/error`)
- [x] Auto-detection: Yüklü DB driver'ları otomatik bulunur
- [x] Multi-service demo (Order → User, 2 servis, 98 event)
- [x] Cross-service trace propagation (W3C `traceparent` + `x-paradox-hlc`)

### Kanıtlanan Başarı ✅
```
2 servis, 98 event → birebir replay

order-service: 59 event (HTTP, Math.random, Date.now, fetch, DB)
user-service:  21 event (HTTP, Math.random, Date.now)
Cross-service traceId: abc123... (her iki serviste de aynı)
```

---

## Phase 2: Time-Travel UI ✅ TAMAMLANDI

**Hedef**: Görsel zaman yolculuğu debugger

### Tamamlananlar
- [x] Web UI server (`@paradox/ui`) — static files + API proxy
- [x] Dark theme tasarım
- [x] Session listesi + arama
- [x] İnteraktif event timeline (tıklanabilir markerlar)
- [x] Service flow diagram (servisler arası ok diyagramı)
- [x] Event detail panel (JSON syntax highlighting)
- [x] Keyboard shortcuts (←/→/j/k, Space, Home/End)
- [x] 5sn auto-refresh
- [x] Full-stack demo: 4 servis tek komutla (`npm run demo:fullstack`)

### Kanıtlanan Başarı ✅
```
http://localhost:3000 → Session listesi, timeline, event detayı
Keyboard navigation → ← → Space Home/End çalışıyor
```

---

## Phase 3: Production Hardening ✅ TAMAMLANDI

**Hedef**: Production'a hazır güvenlik ve kontrol katmanları

### Smart Sampling (`packages/paradox-probe/src/sampling.ts`)
- [x] Head+tail hybrid sampling (tail asla hata kaçırmaz)
- [x] 6 sampling reason: `error`, `latency`, `new_path`, `upstream`, `adaptive`, `random`
- [x] Adaptive auto-escalation (hata oranı >%5 → 30sn %100 sampling)
- [x] Path normalization (`/users/123` → `/users/:id`)
- [x] Sliding window stats (son 1 dakika)

### Deep Field Redaction (`packages/paradox-probe/src/redaction.ts`)
- [x] Recursive object walking (iç içe nesnelerde alan tarama)
- [x] Field name matching (case-insensitive)
- [x] Glob path patterns
- [x] Auto-detect: JWT, kredi kartı, Bearer token, AWS key, PEM private key
- [x] Orijinal obje asla mutate edilmez

### Session Export/Import (`packages/paradox-core/src/session-io.ts`)
- [x] JSON format export/import
- [x] Binary PRDX format (magic + gzip + CRC32, ~%24 küçük)
- [x] Roundtrip guaranteed

### CLI Tool (`packages/paradox-cli/`)
- [x] 10 komut: `sessions`, `inspect`, `timeline`, `trace`, `export`, `import`, `stats`, `watch`, `health`, `help`
- [x] ANSI renkli çıktı, `PARADOX_COLLECTOR_URL` env desteği

### Performance Benchmark (`packages/paradox-probe/src/benchmark.ts`)
- [x] Date.now() / Math.random() / redaction overhead ölçümü
- [x] Baseline vs instrumented karşılaştırması

### Kanıtlanan Başarı ✅
```
Smart Sampling: new_path detect, 5xx upgrade, adaptive trigger ✓
Deep Redaction: password → [REDACTED], JWT auto-detect ✓
Binary Export: 551B JSON → 420B binary (-%24), roundtrip ✓
CLI: 32 session listelendi, health OK ✓
```

---

## Phase 4: Launch Ready ✅ TAMAMLANDI

**Hedef**: npm publish'e hazır paket yapısı

### Tamamlananlar
- [x] TypeScript build pipeline (`tsc` → `dist/` — sıfır hata)
- [x] `composite: true` + `types: ["node"]` tsconfig
- [x] `@types/node` tüm paketlerde
- [x] `exports` field (ESM + types conditions)
- [x] `files` field, `prepublishOnly`, `bin` entries
- [x] `.npmignore` tüm paketlerde
- [x] Per-package README: core, probe, collector, replay, cli
- [x] `npm pack --dry-run` başarılı
- [x] Tüm 6 paket `0.4.0`'a yükseltildi

### npm Pack Test ✅
```
@paradox/core:  14.3 kB  ✓
@paradox/cli:   12.3 kB  ✓
Tüm paketler npm publish'e hazır
```

---

## Phase 5: Scale & Launch (Planlanıyor)

**Hedef**: Production ölçeğinde sistem + ilk müşteriler

### Altyapı
- [ ] Rust collector (gRPC ingestion, yüksek throughput)
- [ ] Content-Addressable Storage (SHA-256 deduplication, ~%50 tasarruf)
- [ ] Delta compression
- [ ] Tiered storage: memory → SSD → S3
- [ ] Configurable retention policy

### Deployment
- [ ] Docker image + Docker Compose
- [ ] Kubernetes operator + Helm chart
- [ ] CI/CD pipeline (GitHub Actions)

### Performance
- [ ] Load test: 1M event/sn hedefi
- [ ] <%1 overhead production kanıtı

### Launch
- [ ] npm publish (tüm paketler)
- [ ] Landing page + docs site
- [ ] Open source release (Community Edition)
- [ ] Managed cloud beta
- [ ] Integration guides (Express, NestJS, Fastify, Koa)
- [ ] Product Hunt launch
- [ ] Hacker News: "Show HN"

---

## Gelecek Vizyon (12+ ay)

- Python, Go, Java, Ruby probe'ları
- AI-powered root cause analysis
- Otomatik anomaly detection
- Collaborative debugging (session paylaşımı)
- Datadog / Grafana / PagerDuty entegrasyonları
- Chaos engineering integration
