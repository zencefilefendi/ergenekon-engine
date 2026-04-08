# PARADOX Engine — Vizyon Dokumani

## Neden Varız?

Yazilim dunyasi son 20 yilda devasa bir donusum gecirdi:
- Monolith → Microservices
- Single server → Kubernetes clusters
- Senkron → Asenkron event-driven

Ama debugging araclari hala 2005'te kaldi. `console.log` ve log aggregation ile debug yapiyoruz.

**Bu kabul edilemez.**

Bir ucak dusmeden once kara kutusu kayit yapar. Duserse, muhendisler saniye saniye ne oldugunu geri sarabilir. Yazilim dunyasinin kara kutusu yok. PARADOX bu kara kutuyu insa ediyor.

## Misyon

> Her production incident'i 5 dakika icinde reproduce edilebilir kilmak.

## Hedef Kitle

### Birincil: Backend/Platform Muhendisleri
- Microservice mimarileri kullanan takimlar
- Gunluk olarak production debugging yapan insanlar
- On-call muhendisler (gece 3'te pager caldiginda)

### Ikincil: Engineering Yoneticileri
- MTTR (Mean Time To Resolution) metriklerini iyilestirmek isteyenler
- Debugging'e harcanan muhendislik saatini azaltmak isteyenler

### Ucuncul: DevOps/SRE Takimlari
- Observability stack'lerini guclendirmek isteyenler
- Incident response surelerini kisaltmak isteyenler

## Rekabet Analizi

### Mevcut Araclar ve Eksiklikleri

| Arac | Ne Yapiyor | Eksigi |
|------|-----------|--------|
| **Datadog** | Log/trace/metric toplama | Sadece GOZLEM — replay yok, state yok |
| **Jaeger/Zipkin** | Distributed tracing | Timing gorursun ama DATA'yi goremezsin |
| **Sentry** | Error tracking | Hatayi gorursun ama nasil oraya geldigini goremezsin |
| **Replay.io** | Browser record/replay | Sadece frontend — backend'i gormez |
| **rr (Mozilla)** | Linux process record/replay | Tek makine, tek process — distributed degil |
| **Chaos Engineering** | Hatalari simule et | Onceden tahmin — gercek bug'lari replay etmez |

### PARADOX'un Farkı

**Hicbiri production'da gerceklesen bir distributed bug'i birebir replay edemiyor.**

PARADOX tek basiniza bunu yapabilen ilk arac.

## Pazar Buyuklugu

- Global APM/Observability pazari: ~$20B (2024), ~$50B (2028 tahmini)
- Hedef segment: Microservice kullanan orta-buyuk olcekli sirketler
- Potansiyel musteri sayisi: 500,000+ sirket globally
- Ortalama kontrat: $10,000-100,000/yil
- **Ilk yil hedefi**: 100 musteri x $50,000 = $5M ARR

## Gelir Modeli

### Open-Core
- **Community Edition (Ucretsiz)**: Tek servis record/replay, 24 saat retention
- **Pro ($50/dev/ay)**: Multi-service, 30 gun retention, time-travel UI
- **Enterprise ($200/dev/ay)**: Sinirsiz retention, SSO, RBAC, on-prem, SLA

### Managed Cloud
- Collector + Storage hosted
- Pay-per-event pricing
- Auto-scaling

## Teknik Zorluklar ve Cozumler

### 1. Non-Determinizm Problemi
**Zorluk**: Ayni kodu ayni input ile calistirsan bile, sonuc farkli olabilir (zaman, random, thread scheduling).

**Cozum**: Tum non-determinizm kaynaklarini I/O boundary'lerinde yakala:
- `Date.now()` → kaydedilen zamani dondur
- `Math.random()` → kaydedilen seed'i kullan
- HTTP cagrilari → kaydedilen response'u dondur
- DB sorgulari → kaydedilen sonucu dondur

Anahtar fikir: **Uygulamanin ICINI kaydetmeye gerek yok.** Disariya acilan tum kapilari (I/O boundaries) yakalarsan, icerisi deterministik olarak ayni calisir.

### 2. Overhead Problemi
**Zorluk**: Production'da her seyi kaydetmek performansi oldurur.

**Cozum**:
- **Delta encoding**: Sadece degisiklikleri kaydet
- **Content-addressable storage**: Ayni response'u bir kere sakla, hash ile referans ver
- **Smart sampling**: Her request'i degil, ilginc olanlari kaydet (yeni path, yuksek latency, hata)
- **Async flush**: Kayitlari async buffer'a yaz, ana thread'i bloklama

**Hedef**: <%1 CPU overhead, <%5 memory overhead

### 3. Distributed Ordering Problemi
**Zorluk**: 10 farkli makinede olaylarin GERCEK sirasini bilmek imkansiz (saat senkronizasyonu eksik).

**Cozum**: Hybrid Logical Clocks (HLC)
- Fiziksel saat + mantiksal sayac kombinasyonu
- Causality'yi (nedensellik) garanti eder
- NTP dogruluguna bagimli DEGIL
- Leslie Lamport'un calismasindan turetilmis, pratikte kanitlanmis

### 4. Storage Problemi
**Zorluk**: Milyonlarca request x servis basina yuzlerce event = petabyte veri.

**Cozum**:
- **Content-Addressable Storage (CAS)**: Her event'in hash'i anahtar, ayni icerik = ayni hash = tek kopya
- **Tiered storage**: Son 1 saat RAM'de, son 1 gun SSD'de, gerisi S3'te
- **Aggressive deduplication**: HTTP response body'leri, DB sonuclari genelde tekrar eder
- **Configurable retention**: Musteri ne kadar tutmak isterse

## Yol Haritasi

### v0.1 — Proof of Concept ✅
- [x] Node.js probe (HTTP + temel I/O intercept)
- [x] In-memory collector
- [x] Basit CLI replay
- [x] Tek servis record/replay

### v0.2 — Multi-Service ✅
- [x] Distributed tracing entegrasyonu (trace ID propagation)
- [x] HLC implementation
- [x] Multi-service replay
- [x] Basit web UI

### v0.3 — Production Essentials ✅
- [x] Smart sampling (head+tail hybrid, 6 reason, adaptive)
- [x] Deep field redaction (PII/secret auto-detect)
- [x] Session export/import (JSON + binary PRDX format)
- [x] CLI tool (10 komut, ANSI renkli cikti)
- [x] Performance benchmark

### v0.4 — Production-Ready (Sirada)
- [ ] Rust collector (yuksek performans)
- [ ] CAS storage engine
- [ ] Delta compression
- [ ] Kubernetes operator

### v1.0 — Launch
- [ ] Time-travel UI (gorsel debugger)
- [ ] Team collaboration features
- [ ] SSO/RBAC
- [ ] Managed cloud offering

## Ilham Kaynaklari

- **rr (Mozilla)**: Tek process record/replay — biz bunu distributed yapiyoruz
- **Replay.io**: Browser record/replay — biz bunu backend'e tasiyoruz
- **Hermit (Meta)**: Deterministic Linux container — biz bunu application-level yapiyoruz
- **Lamport Clocks**: Distributed ordering icin temel teori
- **Event Sourcing**: Tum state'i event'lerden turet — benzer felsefe
