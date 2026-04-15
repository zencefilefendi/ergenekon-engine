# ERGENEKON Engine — Sistem Topolojisi

Bu belge ERGENEKON Engine'in deployment topolojisini, servisler arası iletişimi, port haritasını ve veri akışını açıklar.

---

## Genel Topoloji

```
╔══════════════════════════════════════════════════════════════════════════╗
║                         KULLANICI UYGULAMASI                            ║
║                                                                          ║
║  ┌─────────────────────┐    ┌─────────────────────┐                     ║
║  │    order-service    │    │    user-service      │   ... N services    ║
║  │    :3001            │───►│    :3002             │                     ║
║  │                     │    │                      │                     ║
║  │  ┌───────────────┐  │    │  ┌───────────────┐  │                     ║
║  │  │ @ergenekon/probe│  │    │  │ @ergenekon/probe│  │                     ║
║  │  │               │  │    │  │               │  │                     ║
║  │  │ HTTP intercept│  │    │  │ HTTP intercept│  │                     ║
║  │  │ DB intercept  │  │    │  │ DB intercept  │  │                     ║
║  │  │ Date.now()    │  │    │  │ Date.now()    │  │                     ║
║  │  │ Math.random() │  │    │  │ Math.random() │  │                     ║
║  │  │ Smart Sampling│  │    │  │ Smart Sampling│  │                     ║
║  │  │ Deep Redaction│  │    │  │ Deep Redaction│  │                     ║
║  │  └───────┬───────┘  │    │  └───────┬───────┘  │                     ║
║  └──────────┼──────────┘    └──────────┼──────────┘                     ║
╚═════════════╪═══════════════════════════╪══════════════════════════════╝
              │  HTTP POST /api/v1/sessions│
              │  (async, non-blocking)     │
              ▼                            ▼
╔══════════════════════════════════════════════════════════════════════════╗
║                     ERGENEKON COLLECTOR  :4380                            ║
║                                                                          ║
║  ┌──────────────┐   ┌──────────────┐   ┌──────────────────────────┐    ║
║  │  REST API    │   │  HLC         │   │  File Storage            │    ║
║  │  Ingestion   │──►│  Ordering    │──►│                          │    ║
║  │              │   │  Engine      │   │  .ergenekon-recordings/    │    ║
║  │  POST /api/  │   │              │   │  sessions/               │    ║
║  │  v1/sessions │   │  Causal      │   │  ├── 01HWXYZ.json        │    ║
║  │  GET  /api/  │   │  ordering    │   │  ├── 01HWABC.json        │    ║
║  │  v1/sessions │   │  across      │   │  └── ...                 │    ║
║  │  GET  /traces│   │  services    │   │                          │    ║
║  └──────────────┘   └──────────────┘   └──────────────────────────┘    ║
╚══════════════════════════════════════════════════════════════════════════╝
              │                    │                    │
              ▼                    ▼                    ▼
╔════════════════╗   ╔═══════════════════╗   ╔══════════════════════════╗
║ TIME-TRAVEL UI ║   ║  ERGENEKON CLI      ║   ║  REPLAY ENGINE           ║
║ :3000          ║   ║                   ║   ║                          ║
║                ║   ║  ergenekon sessions ║   ║  Mocked I/O:             ║
║ Session list   ║   ║  ergenekon inspect  ║   ║  - Date.now() → recorded ║
║ Timeline       ║   ║  ergenekon timeline ║   ║  - Math.random() → rec.  ║
║ scrubber       ║   ║  ergenekon trace    ║   ║  - fetch() → recorded    ║
║ Service flow   ║   ║  ergenekon export   ║   ║  - DB queries → recorded ║
║ Event detail   ║   ║  ergenekon watch    ║   ║                          ║
╚════════════════╝   ╚═══════════════════╝   ╚══════════════════════════╝
```

---

## Port Haritası

| Servis | Port | Protokol | Açıklama |
|--------|------|----------|----------|
| **Time-Travel UI** | 3000 | HTTP | Web arayüzü (static files + API proxy) |
| **Order Service** (demo) | 3001 | HTTP | Örnek downstream servis |
| **User Service** (demo) | 3002 | HTTP | Örnek upstream servis |
| **ERGENEKON Collector** | 4380 | HTTP REST | Probe'lardan kayıt alır, UI'ye sunar |
| **PostgreSQL** (isteğe bağlı) | 5432 | TCP | İzlenen veritabanı |
| **Redis** (isteğe bağlı) | 6379 | TCP | İzlenen cache |
| **MongoDB** (isteğe bağlı) | 27017 | TCP | İzlenen document store |

---

## Veri Akışı (Request Yaşam Döngüsü)

### 1. Request Gelişi — Probe HEAD Kararı

```
Dış dünya (curl/browser)
        │
        │ HTTP POST /api/orders
        ▼
┌──────────────────────────────────────────────┐
│  order-service :3001                         │
│                                              │
│  1. ergenekonMiddleware çalışır                │
│  2. SamplingEngine.headDecision() çağrılır   │
│     → new_path? upstream? adaptive? random?  │
│  3. RecordingSession oluşturulur             │
│     → traceId (W3C) generate                 │
│     → spanId generate                        │
│     → AsyncLocalStorage'a konulur            │
│  4. http_request_in event kaydedilir         │
│     → method, path, headers, body            │
│     → sensitive fields REDACT edilir         │
│  5. next() çağrılır → uygulama kodu çalışır  │
└──────────────────────────────────────────────┘
```

### 2. Uygulama Kodu Çalışırken — Interceptor'lar

```
Uygulama kodu içinde:

Date.now() çağrısı
    │ globals.ts intercept
    ▼
  timestamp event → AsyncLocalStorage'dan session al → record()

Math.random() çağrısı
    │ globals.ts intercept
    ▼
  random event → session.record()

fetch('http://user-service/api/users/1')
    │ http-outgoing.ts intercept
    ▼
  1. http_request_out event → kaydet
  2. W3C traceparent header enjekte → cross-service trace
  3. x-ergenekon-hlc header enjekte → distributed clock sync
  4. Gerçek fetch çalışır
  5. Response klonlanır (body stream bir kez okunabilir)
  6. http_response_in event → kaydet

db.query('SELECT * FROM users WHERE id=$1')
    │ database.ts intercept (pg/ioredis/mongoose)
    ▼
  db_query event → kaydet
  Gerçek sorgu çalışır
  db_result event → kaydet
```

### 3. Response — Probe TAIL Kararı

```
Uygulama res.json(...) çağırır
    │
    ▼
res.end() intercept (http-incoming.ts)
    │
    ├── http_response_out event kaydet
    │   → statusCode, headers, body (redacted)
    │   → durationMs hesapla
    │
    ├── SamplingEngine.tailDecision() çağır
    │   → HEAD "hayır" dediyse bile:
    │      hata (5xx)? → EVET kaydet
    │      yüksek latency? → EVET kaydet
    │
    ├── session.finalize() → RecordingSession oluştur
    │
    └── CollectorClient.enqueue(session)
              │ async, non-blocking
              ▼
        POST /api/v1/sessions → Collector'a gönder
```

### 4. Collector — Depolama

```
POST /api/v1/sessions
    │
    ▼
┌──────────────────────────────────────┐
│  Collector :4380                     │
│                                      │
│  1. Session JSON parse               │
│  2. HLC timestamp ile sırala        │
│  3. traceId ile index güncelle       │
│  4. sessions/[id].json dosyaya yaz   │
│  5. In-memory index güncelle         │
│  6. 200 OK response                  │
└──────────────────────────────────────┘
          │
          ▼
  .ergenekon-recordings/
    sessions/
      01HWXYZ...json  ← Bu session'ın tüm event'leri
```

---

## Cross-Service Trace Propagation

İki servis arasındaki bağlantı W3C Trace Context standardıyla sağlanır:

```
order-service                          user-service
     │                                      │
     │ fetch('http://user-service/...')      │
     │                                      │
     │  Headers enjekte et:                 │
     │  traceparent: 00-{traceId}-{spanId}-01
     │  x-ergenekon-hlc: {"wallTime":...}    │
     │                                      │
     │──────────────────────────────────────►│
     │                                      │
     │                          ergenekonMiddleware:
     │                          1. traceparent parse et
     │                          2. traceId'yi al (AYNI traceId)
     │                          3. parentSpanId'yi al
     │                          4. HLC receive → distributed clock sync
     │                          5. Kendi session'ını oluştur
     │                             (aynı traceId, yeni spanId)
     │
     │ Collector'da:
     │   traceId: "abc123..."
     │   ├── order-service session (spanId: "aaa")
     │   └── user-service session (spanId: "bbb", parentSpanId: "aaa")
```

Bu sayede Collector `GET /api/v1/traces/abc123...` ile iki session'ı birden getirir.

---

## Bileşen Sorumlulukları

### @ergenekon/probe — "Kamera"

Her servise yerleştirilen kamera. Uygulamayı değiştirmeden, sıfır konfigürasyonla, tüm I/O'yu yakalar.

**Sorumluluklar:**
- Monkey-patching ile interceptor kurulumu
- AsyncLocalStorage ile context propagation
- Smart sampling kararları (head + tail)
- PII/secret redaction
- CollectorClient ile async gönderi
- W3C trace context propagation

### @ergenekon/collector — "Kayıt Merkezi"

Tüm probe'lardan gelen kayıtları toplayan, sıralayan ve saklayan sunucu.

**Sorumluluklar:**
- HTTP REST API ile kayıt alma
- HLC ile cross-service event sıralaması
- traceId bazlı index yönetimi
- File-based JSON storage
- UI ve CLI için sorgu API'si
- CORS headers (UI erişimi için)

### @ergenekon/replay — "VCR"

Kaydedilmiş bir session'ı alıp, tüm I/O'yu mock'layarak deterministik şekilde tekrar çalıştıran motor.

**Sorumluluklar:**
- Session yükleme (dosya veya obje)
- MockLayer: sıralı event cursor ile I/O mock
- Timeline inspection (getTimeline, getStateAt, getDiff)
- Divergence detection (ReplayDivergenceError)
- Time-travel scrubbing (seekTo)

### @ergenekon/ui — "İzleme Odası"

Dark theme web arayüzü. Session'ları listele, timeline'ı scrub et, event detaylarını incele.

**Sorumluluklar:**
- Static dosya sunumu (HTML/CSS/JS)
- Collector API proxy (/api/* → :4380)
- Session listesi + arama
- İnteraktif event timeline (her event bir marker)
- Service flow diagram (servisler arası ok)
- Event detail panel (JSON syntax highlighting)
- Keyboard shortcuts (←/→, Space, Home/End)
- 5 saniyede bir auto-refresh

### @ergenekon/cli — "Terminal Araçları"

10 komutluk ANSI renkli CLI. Arayüz açmadan terminal'den tam kontrol.

**Sorumluluklar:**
- Collector REST API ile haberleşme
- Session listesi, inspect, timeline, trace görüntüleme
- JSON ve binary (PRDX) format export/import
- Canlı izleme (watch/tail modu)
- Sağlık kontrolü

### @ergenekon/core — "Temel Katman"

Tüm paketlerin paylaştığı sıfır-bağımlılık temel kütüphane.

**Sorumluluklar:**
- TypeScript tip tanımları (ErgenekonEvent, RecordingSession, ...)
- Hybrid Logical Clock (HLC) implementasyonu
- ULID üretici (time-sortable, URL-safe)
- Session import/export (JSON + binary PRDX format)

---

## Deployment Senaryoları

### Senaryo 1: Lokal Geliştirme (tek komut)

```bash
npm run demo:fullstack
# Collector :4380, UI :3000, 2 demo servis başlar
```

### Senaryo 2: Mevcut Servise Ekleme

```typescript
// services/order-service/src/app.ts
import { ErgenekonProbe } from '@ergenekon/probe';

const probe = new ErgenekonProbe({
  serviceName: 'order-service',
  collectorUrl: process.env.ERGENEKON_COLLECTOR_URL || 'http://ergenekon-collector:4380',
  sampling: { baseRate: 0.01, alwaysSampleErrors: true },
});
app.use(probe.middleware());
```

```bash
# Collector ayrı çalışıyor
docker run -p 4380:4380 ergenekon/collector
```

### Senaryo 3: Docker Compose

```yaml
# docker-compose.yml
services:
  collector:
    image: ergenekon/collector:0.4.0
    ports: ["4380:4380"]
    volumes: ["./recordings:/data"]

  ui:
    image: ergenekon/ui:0.4.0
    ports: ["3000:3000"]
    environment:
      - ERGENEKON_COLLECTOR_URL=http://collector:4380

  order-service:
    build: ./services/order-service
    environment:
      - ERGENEKON_COLLECTOR_URL=http://collector:4380
```

### Senaryo 4: Kubernetes (gelecek)

```yaml
# ergenekon-collector deployment
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ergenekon-collector
spec:
  replicas: 1
  template:
    spec:
      containers:
      - name: collector
        image: ergenekon/collector:0.4.0
        ports: [{containerPort: 4380}]
        volumeMounts:
        - name: recordings
          mountPath: /data
```

---

## Event Tipi Haritası

| Event Tipi | Kim Üretir | Ne Zaman | Ne Kaydedilir |
|------------|-----------|---------|--------------|
| `http_request_in` | probe/http-incoming | Request gelince | method, path, headers, body |
| `http_response_out` | probe/http-incoming | Response gönderilince | statusCode, headers, body, durationMs |
| `http_request_out` | probe/http-outgoing | fetch() çağrılınca | url, method, headers |
| `http_response_in` | probe/http-outgoing | fetch() yanıt gelince | statusCode, body, durationMs |
| `db_query` | probe/database | Sorgu başlayınca | engine, sql/command, params |
| `db_result` | probe/database | Sorgu bitince | rowCount/result, durationMs |
| `cache_get` | probe/database | Redis/cache okuyunca | command, key |
| `cache_set` | probe/database | Redis/cache yazınca | command, key, result |
| `timestamp` | probe/globals | Date.now() çağrılınca | value (ms) |
| `random` | probe/globals | Math.random() çağrılınca | value (0-1) |
| `uuid` | probe/globals | crypto.randomUUID() | value |
| `timer_set` | probe/timers | setTimeout/setInterval | delay, type |
| `timer_fire` | probe/timers | Timer tetiklenince | timerId, actualDelay |
| `error` | probe/errors | Uncaught exception | name, message, stack |
| `custom` | kullanıcı | Manuel çağrı | kullanıcı tanımlı |

---

## Güvenlik Katmanları

```
Uygulama Kodu
     │
     │ Her event buradan geçer:
     ▼
┌─────────────────────────────────────┐
│  LAYER 1: Header Redaction          │
│  authorization, cookie, x-api-key  │
│  → [REDACTED]                       │
└────────────────────┬────────────────┘
                     │
                     ▼
┌─────────────────────────────────────┐
│  LAYER 2: Field Name Matching       │
│  password, secret, token, ssn,      │
│  creditCard, privateKey, ...        │
│  → [REDACTED]                       │
└────────────────────┬────────────────┘
                     │
                     ▼
┌─────────────────────────────────────┐
│  LAYER 3: Value Auto-Detection      │
│  JWT pattern → [REDACTED]           │
│  Credit card regex → [REDACTED]     │
│  Bearer token → [REDACTED]          │
│  AWS key pattern → [REDACTED]       │
│  PEM private key → [REDACTED]       │
└────────────────────┬────────────────┘
                     │
                     ▼
              Storage (temiz veri)
```

---

## Performans Hedefleri

| Metrik | Hedef | Mevcut Durum |
|--------|-------|-------------|
| Probe overhead (sampling off) | <0.01ms | ~0.001ms |
| Probe overhead (sampling on) | <1ms | ~0.1ms |
| Event throughput | 1M event/sn | ~100K event/sn |
| Collector ingestion | 10K req/sn | ~1K req/sn |
| Storage per event | <1KB | ~2KB (JSON) / ~0.5KB (binary) |
| Replay accuracy | %100 | %100 (kanıtlandı) |

---

## Hata Senaryoları

| Senaryo | Davranış |
|---------|----------|
| Collector çevrimdışı | Probe buffer'lar (max: 1000 session), sonra siler |
| Collector yavaş | Probe async gönderir, uygulama bloklanmaz |
| Buffer doldu | En eski kayıtlar silinir (ring buffer) |
| Redaction hatası | Log + skip (recording devam eder) |
| Replay divergence | ReplayDivergenceError fırlatılır |
| Collector disk dolu | 500 döner, probe retry yapar |
