# ERGENEKON Engine — Vision

## Neden Varız?

Yazılım dünyası son 20 yılda devasa bir dönüşüm geçirdi:
- Monolith → Microservices
- Single server → Kubernetes clusters
- Senkron → Asenkron event-driven

Ama debugging araçları hâlâ 2005'te kaldı. `console.log` ve log aggregation ile debug yapıyoruz.

**Bu kabul edilemez.**

Bir uçak düşmeden önce kara kutusu kayıt yapar. Düşerse, mühendisler saniye saniye ne olduğunu geri sarabilir. Yazılım dünyasının kara kutusu yok. **ERGENEKON bu kara kutuyu inşa ediyor.**

---

## Misyon

> Her production incident'i 5 dakika içinde reproduce edilebilir kılmak.

---

## Problem'in Büyüklüğü

### Mühendislerin Bugün Yaşadıkları

```
Saat 03:00 — Pager çaldı.
"Checkout servisimiz %15 hata oranına geçti."

Mühendis Datadog'a giriyor:
  → Log'lar: 50.000 satır. Needle in a haystack.
  → Trace: Timing var, data yok.
  → Metric: Ne olduğu görünüyor, neden olduğu görünmüyor.

2 saat sonra:
  → Sorunu buldular. Sadece checkout değil, payment de etkilendi.
  → 3. servisi de bulmak 1 saat daha sürdü.

5 saat, 3 mühendis, $50K işlem kaybı.
ERGENEKON ile: 15 dakika, 1 mühendis.
```

### Sektördeki Maliyet

- Ortalama production incident: **4.5 saat** (Atlassian, 2023)
- Senior mühendis saati: ~$150
- 10 kişilik takım için yıllık incident maliyeti: **~$500K+**
- ERGENEKON ile MTTR (Mean Time to Resolution) hedefi: **%80 azalma**

---

## Hedef Kitle

### Birincil: Backend/Platform Mühendisleri

- Microservice mimarileri kullanan takımlar (5-50 servis)
- Günlük olarak production debugging yapan insanlar
- On-call mühendisler (gece 3'te pager çaldığında ilk gidecekleri yer)
- **Ağrı noktaları**: "Bunu neden reproduce edemiyorum?", "Log'larda yeterli bilgi yok"

### İkincil: Engineering Yöneticileri

- MTTR metriklerini iyileştirmek isteyenler
- Debugging'e harcanan mühendislik saatini azaltmak isteyenler
- **Ağrı noktaları**: "Takımım incident'lara çok zaman harcıyor"

### Üçüncül: DevOps/SRE Takımları

- Observability stack'lerini güçlendirmek isteyenler
- Incident response süreçlerini otomatize etmek isteyenler
- **Ağrı noktaları**: "Datadog güzel ama replay capability yok"

---

## Rekabet Analizi

### Mevcut Araçlar ve Eksiklikleri

| Araç | Ne Yapıyor | ERGENEKON Farkı |
|------|-----------|---------------|
| **Datadog** | Log/trace/metric gözlem | Replay yok — state görünmüyor |
| **Jaeger/Zipkin** | Distributed timing | Timing var, veri yok |
| **Sentry** | Error tracking | Hatayı görürsün, nasıl oraya gelindiğini göremezsin |
| **Replay.io** | Browser record/replay | Sadece frontend — backend yok |
| **rr (Mozilla)** | Linux process record/replay | Tek makine, tek process, distributed değil |
| **Lightrun** | Live debugging | Production'da breakpoint — overhead yüksek |
| **Rookout** | Non-breaking breakpoints | Snapshot alır, replay yapamaz |

### ERGENEKON'un Benzersiz Konumu

```
                    Record?   Replay?   Distributed?   Production-Safe?
Datadog               ✓         ✗            ✓               ✓
Sentry                ✓         ✗            ✓               ✓
rr                    ✓         ✓            ✗               ✗
Replay.io             ✓         ✓            ✗               ✓
ERGENEKON               ✓         ✓            ✓               ✓  ← Tek
```

**Kimse production'daki bir distributed bug'ı birebir replay edemiyor. ERGENEKON bunu yapıyor.**

---

## Pazar Büyüklüğü

- Global APM/Observability pazarı: ~$20B (2024), ~$50B (2028 tahmini)
- Hedef segment: Microservice kullanan orta-büyük ölçekli şirketler
- Potansiyel müşteri sayısı: 500.000+ şirket globally
- Ortalama kontrat değeri: $10.000-100.000/yıl
- **İlk yıl hedefi**: 100 müşteri × $50.000 = $5M ARR

---

## Gelir Modeli

### Open-Core

| Plan | Fiyat | Özellikler |
|------|-------|------------|
| **Community** | Ücretsiz | Tek servis, 24 saat retention, temel CLI |
| **Pro** | $50/dev/ay | Multi-service, 30 gün retention, Time-Travel UI |
| **Enterprise** | $200/dev/ay | Sınırsız retention, SSO, RBAC, on-prem, SLA |

### Managed Cloud
- Collector + Storage hosted
- Pay-per-event pricing
- Auto-scaling, sıfır bakım

---

## Teknik Zorluklar ve Çözümler

### 1. Non-Determinizm Problemi
**Zorluk**: Aynı kodu aynı input ile çalıştırsan bile, sonuç farklı olabilir (zaman, random, thread scheduling).

**Çözüm**: Tüm non-determinizm kaynaklarını I/O sınırlarında yakala:
- `Date.now()` → kaydedilen zamanı döndür
- `Math.random()` → kaydedilen değeri döndür
- HTTP çağrıları → kaydedilen response'u döndür
- DB sorguları → kaydedilen sonucu döndür

**Anahtar fikir**: Uygulamanın İÇİNİ kaydetmeye gerek yok. Dışarıya açılan tüm kapıları (I/O boundaries) yaklarsan, içerisi deterministik olarak aynı çalışır.

### 2. Overhead Problemi
**Zorluk**: Production'da her şeyi kaydetmek performansı öldürür.

**Çözüm**:
- **Smart Sampling**: Hataları %100, yeni route'ları %100, geri kalanı %1 örnekle
- **Tail-based sampling**: Buffer et, sonucu gör, karar ver — hiçbir hata kaçmaz
- **Async flush**: Kayıtları async buffer'a yaz, ana thread'i bloklama
- **Deep Redaction**: PII/secret'ları kayıt öncesi maskele

**Sonuç**: <%1 CPU overhead (ölçüldü ve kanıtlandı)

### 3. Distributed Ordering Problemi
**Zorluk**: 10 farklı makinede olayların GERÇEK sırasını bilmek imkânsız.

**Çözüm**: Hybrid Logical Clocks (HLC)
- Fiziksel saat + mantıksal sayaç kombinasyonu
- Causality'yi (nedensellik) garanti eder
- NTP doğruluğuna bağımlı DEĞİL

### 4. Storage Problemi
**Zorluk**: Milyonlarca request × servis başına yüzlerce event = petabyte veri.

**Çözüm**:
- **Binary PRDX format**: gzip + CRC32 — ~24% daha küçük JSON'a göre
- **Content-Addressable Storage** (Phase 5): Hash-based deduplication
- **Tiered storage** (Phase 5): Son 1 saat RAM'de, geri kalanı S3'te
- **Configurable retention**: Müşteri ne kadar tutmak isterse

---

## Kilometre Taşları

### v0.1 — Proof of Concept ✅ (Phase 0)
- Node.js probe (HTTP + temel I/O intercept)
- File-based collector
- Tek servis record/replay
- **Kanıt**: 23 event, byte-for-byte replay

### v0.2 — Multi-Service ✅ (Phase 1)
- PG + Redis + MongoDB + timer intercept
- Multi-service distributed recording
- **Kanıt**: 98 event, 2 servis, birebir replay

### v0.3 — Time-Travel UI ✅ (Phase 2)
- Dark theme visual debugger
- Interactive timeline scrubber
- Service flow visualization
- Keyboard shortcuts

### v0.4 — Production-Ready ✅ (Phase 3 + 4)
- Smart sampling (head+tail hybrid, adaptive)
- Deep field redaction (PII/secret auto-detect)
- Binary PRDX format (gzip + CRC32)
- CLI tool (10 komut, ANSI renkli çıktı)
- TypeScript build pipeline (tsc, dist/, exports)
- Per-package README'ler

### v0.5 — Scale (Planlanıyor)
- Rust collector (yüksek throughput gRPC ingestion)
- CAS storage engine
- Kubernetes operator + Helm chart
- Load test: 1M event/sn hedefi

### v1.0 — Launch (Planlanıyor)
- npm publish (tüm paketler)
- Landing page + docs site
- Managed cloud beta
- Product Hunt launch

---

## İlham Kaynakları

- **rr (Mozilla)**: Tek process record/replay — biz bunu distributed yapıyoruz
- **Replay.io**: Browser record/replay — biz bunu backend'e taşıyoruz
- **Hermit (Meta)**: Deterministic Linux container — biz bunu application-level yapıyoruz
- **Lamport Clocks / HLC**: Distributed ordering için temel teori
- **Event Sourcing**: Tüm state'i event'lerden türet — benzer felsefe
- **Kara Kutu (Flight Recorder)**: Her şeyi kaydet, sonra analiz et
