# PARADOX Engine — Teknik Mimari

## Genel Bakis

PARADOX dort ana paketten olusur. Her biri bagimsiz calisabilir, birlikte guclu bir sistem olusturur.

```
┌─────────────────────────────────────────────────────────────────┐
│                        KULLANICI UYGULAMASI                     │
│                                                                 │
│   ┌─────────────┐   ┌─────────────┐   ┌─────────────┐         │
│   │  Service A   │   │  Service B   │   │  Service C   │        │
│   │             │   │             │   │             │         │
│   │ ┌─────────┐ │   │ ┌─────────┐ │   │ ┌─────────┐ │        │
│   │ │  PROBE  │ │   │ │  PROBE  │ │   │ │  PROBE  │ │        │
│   │ └────┬────┘ │   │ └────┬────┘ │   │ └────┬────┘ │        │
│   └──────┼──────┘   └──────┼──────┘   └──────┼──────┘        │
│          │                 │                 │                 │
└──────────┼─────────────────┼─────────────────┼─────────────────┘
           │                 │                 │
           │    gRPC/HTTP    │    gRPC/HTTP    │
           ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PARADOX COLLECTOR (Rust)                    │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ Event        │  │ HLC          │  │ Compression  │         │
│  │ Ingestion    │──│ Ordering     │──│ Pipeline     │         │
│  │ (async)      │  │ Engine       │  │ (delta+CAS)  │         │
│  └──────────────┘  └──────────────┘  └──────┬───────┘         │
│                                              │                 │
└──────────────────────────────────────────────┼─────────────────┘
                                               │
                    ┌──────────────────────────┼──────┐
                    │                          │      │
                    ▼                          ▼      ▼
          ┌──────────────┐          ┌────────────┐ ┌─────────┐
          │   STORAGE    │          │  REPLAY    │ │  TIME   │
          │   ENGINE     │          │  ENGINE    │ │  TRAVEL │
          │              │          │            │ │  UI     │
          │ ┌──────────┐ │          │ ┌────────┐ │ │         │
          │ │ Hot: RAM  │ │          │ │Sandbox │ │ │ React + │
          │ ├──────────┤ │          │ │Runtime │ │ │ WebGL   │
          │ │ Warm: SSD │ │◄────────│ │        │ │ │         │
          │ ├──────────┤ │          │ │Mock    │ │ │ D3.js   │
          │ │ Cold: S3  │ │          │ │Layer   │ │ │         │
          │ └──────────┘ │          │ └────────┘ │ │         │
          └──────────────┘          └────────────┘ └─────────┘

```

## Paket Detaylari

---

## 1. PARADOX PROBE (`paradox-probe`)

**Dil**: TypeScript
**Hedef**: Node.js uygulamalarina sifir-konfigurasyonla eklenen kayit middleware'i

### Sorumluluklar
- HTTP request/response intercept (incoming + outgoing)
- Database query/response intercept (pg, mysql, mongodb, redis)
- Non-determinizm kaynaklarini intercept (`Date.now`, `Math.random`, `crypto.randomUUID`)
- Timer intercept (`setTimeout`, `setInterval`)
- Trace context propagation (W3C Trace Context standardi)
- Async event buffer + batch gonderim

### Intercept Stratejisi

```
            Gelen Request
                 │
                 ▼
        ┌────────────────┐
        │  HTTP Interceptor │ ──► Kaydeder: method, url, headers, body, timing
        └───────┬────────┘
                │
                ▼
        ┌────────────────┐
        │  App Logic      │
        │                │
        │  Date.now() ───────► Kaydeder: timestamp
        │  Math.random() ────► Kaydeder: deger
        │  db.query() ──────► Kaydeder: query + result
        │  fetch() ─────────► Kaydeder: request + response
        │                │
        └───────┬────────┘
                │
                ▼
        ┌────────────────┐
        │  HTTP Response  │ ──► Kaydeder: status, headers, body, timing
        └────────────────┘
```

### Event Schema

```typescript
interface ParadoxEvent {
  // Kimlik
  id: string;                    // ULID (zamana gore siralanabilir)
  traceId: string;               // W3C Trace ID (distributed tracing)
  spanId: string;                // Bu event'in span'i
  parentSpanId?: string;         // Parent span (causal ordering)

  // Zamanlama
  hlcTimestamp: HLCTimestamp;    // Hybrid Logical Clock
  wallClock: number;             // Gercek zaman (ms)

  // Icerik
  type: EventType;               // 'http_in' | 'http_out' | 'db_query' | 'random' | 'timer' | ...
  serviceName: string;           // Hangi servis
  operationName: string;         // Ne yapiyordu

  // Veri (content-addressed)
  inputHash: string;             // Input verisinin CAS hash'i
  outputHash: string;            // Output verisinin CAS hash'i

  // Metadata
  duration: number;              // Operasyon suresi (ns)
  error?: ErrorInfo;             // Hata varsa
  tags: Record<string, string>;  // Ozel etiketler
}

interface HLCTimestamp {
  wallTime: number;    // Fiziksel saat (ms)
  logical: number;     // Mantiksal sayac
  nodeId: string;      // Hangi node
}

type EventType =
  | 'http_request_in'      // Gelen HTTP request
  | 'http_request_out'     // Giden HTTP request (fetch/axios)
  | 'http_response_in'     // Gelen HTTP response
  | 'http_response_out'    // Giden HTTP response
  | 'db_query'             // Database sorgusu
  | 'db_result'            // Database sonucu
  | 'cache_get'            // Cache okuma
  | 'cache_set'            // Cache yazma
  | 'random'               // Math.random() cagrisi
  | 'timestamp'            // Date.now() cagrisi
  | 'timer_set'            // setTimeout/setInterval
  | 'timer_fire'           // Timer ates etti
  | 'error'                // Yakalanmamis hata
  | 'custom';              // Kullanici tanimli
```

### Monkey-Patching Stratejisi

Non-determinizm kaynaklarini intercept etmek icin monkey-patching kullaniyoruz:

```typescript
// Date.now() intercept
const originalDateNow = Date.now;
Date.now = () => {
  const value = originalDateNow.call(Date);
  if (recording) {
    recorder.record({ type: 'timestamp', value });
  }
  return value;
};

// Replay modunda:
Date.now = () => {
  return replayer.next('timestamp').value;
};
```

Bu yaklasim `rr` ve `Hermit`'in application-level karsiligi.

---

## 2. PARADOX COLLECTOR (`paradox-collector`)

**Dil**: Rust
**Hedef**: Yuksek performansli event toplama, siralama ve sikistirma

### Sorumluluklar
- Event ingestion (gRPC + HTTP)
- HLC timestamp dogrulama ve global ordering
- Delta compression + content-addressable storage
- Tiered storage yonetimi (RAM → SSD → S3)
- Recording session management
- Sampling kararlari

### Veri Akisi

```
Events (gRPC stream)
       │
       ▼
┌──────────────┐     ┌──────────────┐
│ Ingestion    │────►│ HLC          │
│ Buffer       │     │ Validator    │
│ (lock-free)  │     │              │
└──────────────┘     └──────┬───────┘
                            │
                     ┌──────▼───────┐
                     │ Session      │
                     │ Assembler    │ ──► Trace ID'ye gore gruplama
                     └──────┬───────┘
                            │
                ┌───────────┼───────────┐
                ▼           ▼           ▼
         ┌──────────┐ ┌──────────┐ ┌──────────┐
         │ Content  │ │ Delta    │ │ Index    │
         │ Store    │ │ Encoder  │ │ Builder  │
         │ (CAS)    │ │          │ │          │
         └──────────┘ └──────────┘ └──────────┘
```

### Content-Addressable Storage (CAS)

```
Gelen veri: {"user": "ali", "age": 30}
     │
     ▼
Hash: SHA256 → "a1b2c3..."
     │
     ├── Hash zaten var mi? → Evet → Sadece referansi kaydet
     │
     └── Hayir → Veriyi kaydet + hash'i indexle
```

Avantaj: Ayni DB sonucu 1000 kez donerse, 1 kez saklanir.

### Hybrid Logical Clock (HLC) Implementasyonu

```
HLC = (physical_time, logical_counter, node_id)

Kurallar:
1. Yerel event: hlc.physical = max(hlc.physical, wall_clock); hlc.logical++
2. Mesaj gonderme: mesaja hlc'yi ekle
3. Mesaj alma: hlc.physical = max(hlc.physical, msg.hlc.physical, wall_clock)
                hlc.logical = uygun sekilde artir

Sonuc: Tum event'ler GLOBAL olarak siralanabilir, fiziksel saat senkronizasyonu GEREKMEZ.
```

---

## 3. PARADOX REPLAY ENGINE (`paradox-replay`)

**Dil**: TypeScript + Rust (core)
**Hedef**: Kaydedilmis session'lari birebir replay etme

### Sorumluluklar
- Recording session yukle
- Sandbox ortami olustur
- I/O mock layer'i kur
- Deterministik replay calistir
- Breakpoint + step debugging
- Zamanda ileri/geri gitme

### Replay Mimarisi

```
┌─────────────────────────────────────────────────┐
│              REPLAY SANDBOX                      │
│                                                  │
│  ┌─────────────────────────────────────┐        │
│  │         Mock I/O Layer              │        │
│  │                                     │        │
│  │  HTTP In  ──► Kaydedilen request    │        │
│  │  HTTP Out ──► Kaydedilen response   │        │
│  │  DB Query ──► Kaydedilen result     │        │
│  │  Date.now ──► Kaydedilen zaman      │        │
│  │  Random   ──► Kaydedilen deger      │        │
│  └────────────────┬────────────────────┘        │
│                   │                              │
│  ┌────────────────▼────────────────────┐        │
│  │        Application Code             │        │
│  │    (degistirilmemis, orijinal)      │        │
│  └────────────────┬────────────────────┘        │
│                   │                              │
│  ┌────────────────▼────────────────────┐        │
│  │        State Inspector              │        │
│  │    Her adimda state snapshot        │        │
│  └─────────────────────────────────────┘        │
│                                                  │
└─────────────────────────────────────────────────┘
```

### Zamanda Yolculuk Mekanizmasi

```
Event Timeline:
  E1 ──── E2 ──── E3 ──── E4 ──── E5 ──── E6
  │              │                        │
  t=0ms         t=50ms                   t=200ms

Kullanici "E3'e git" dediginde:
1. Son checkpoint'ten baslat (E1)
2. E1 → E2 → E3 replay et
3. E3'teki state'i goster
4. Kullanici ileri/geri gidebilir

Optimizasyon: Her N event'te bir checkpoint kaydet
→ Herhangi bir noktaya O(N/checkpoint_interval) ile ulas
```

---

## 4. PARADOX UI (`paradox-ui`)

**Dil**: TypeScript (React + D3.js)
**Hedef**: Gorsel zaman yolculugu debugger'i

### Ana Gorunum

```
┌─────────────────────────────────────────────────────────────────┐
│  PARADOX                                    ▶ ⏸ ⏮ ⏭  🔍     │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Timeline Bar                                                   │
│  ═══════════●════════════════════════════════════════           │
│  0ms     50ms    100ms    150ms    200ms    250ms    300ms      │
│                                                                 │
├──────────────────────┬──────────────────────────────────────────┤
│                      │                                          │
│  Service Flow        │  Event Detail                            │
│                      │                                          │
│  ┌──────────┐        │  Type: http_request_out                  │
│  │ API GW   │──┐     │  Service: user-service                   │
│  └──────────┘  │     │  Time: 50ms                              │
│                ▼     │  Duration: 23ms                           │
│  ┌──────────┐  │     │                                          │
│  │ User Svc │──┤     │  Request:                                │
│  └──────────┘  │     │  GET /api/users/123                      │
│                ▼     │  Authorization: Bearer eyJ...             │
│  ┌──────────┐  │     │                                          │
│  │ Auth Svc │──┘     │  Response:                               │
│  └──────────┘        │  200 OK                                  │
│                      │  {"id": 123, "name": "Ali"}              │
│  ┌──────────┐        │                                          │
│  │ DB       │        │  State @ this point:                     │
│  └──────────┘        │  { authenticated: true, userId: 123 }    │
│                      │                                          │
├──────────────────────┴──────────────────────────────────────────┤
│  Console: Request completed in 73ms — 4 services, 12 events    │
└─────────────────────────────────────────────────────────────────┘
```

### Ozellikler
- **Timeline scrubbing**: Zaman cubugunu surukleyerek herhangi bir ana git
- **Service graph**: Servislerin birbirleriyle iletisimini canli gor
- **State inspector**: Her event anindaki uygulama state'ini incele
- **Diff view**: Iki zaman noktasi arasindaki state farkini gor
- **Search**: Event'ler icinde arama yap
- **Bookmarks**: Onemli anlari isaretla

---

## Teknik Kararlar

### Neden Node.js Probe'u Monkey-Patching Kullaniyor?
- Sifir konfigurasyonla calisir — `app.use(probe.middleware())` yeterli
- Mevcut kodu degistirmek gerekmiyor
- V8 engine monkey-patching'e uygun

### Neden Collector Rust?
- Yuksek throughput gerekli (milyonlarca event/sn)
- Dusuk ve tahmin edilebilir latency
- Memory safety (production'da crash olmamalı)
- Async runtime (tokio) ile verimli I/O

### Neden HLC (NTP yerine)?
- NTP dogrulugu ~1ms, bu yeterli degil
- HLC causality (nedensellik) GARANTI eder
- Saat kaymalarina dayanikli
- Kanıtlanmis akademik teori (Kulkarni et al., 2014)

### Neden CAS (Content-Addressable Storage)?
- Ayni veri tekrar tekrar gorulur (ornegin ayni DB query sonucu)
- Deduplication otomatik
- Integrity verification ucretsiz (hash = adres)
- Git'in blob storage'ina benzer — kanitlanmis yontem

---

## Guvenlik Notlari

- Probe'lar hassas veriyi (sifre, token, PII) otomatik maskelemeli
- Collector ile probe arasinda TLS zorunlu
- Storage encryption at rest
- RBAC: Kim hangi recording'i gorebilir
- Data retention politikalari (GDPR/KVKK uyumu)
