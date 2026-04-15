# ERGENEKON Engine — Teknik Mimari

Bu belge ERGENEKON Engine'in tüm paketlerini, iç tasarım kararlarını, kritik algoritmaları ve bileşenler arası bağımlılıkları açıklar.

**Durum**: Phase 0 ✅ Phase 1 ✅ Phase 2 ✅ Phase 3 ✅ Phase 4 ✅

---

## Paket Bağımlılık Grafiği

```
@ergenekon/core          (0 bağımlılık — temel katman)
      ▲
      │ import
      ├──────────────────────────────────┐
      │                                  │
@ergenekon/probe          @ergenekon/collector    @ergenekon/replay
(interceptors,          (storage, REST API)   (mock layer,
 sampling, redaction)                          timeline)
      │                      │                    │
      │                      │                    │
      └──────────────────────┴────────────────────┘
                             │
                    @ergenekon/ui  @ergenekon/cli
                    (web UI)     (terminal CLI)
```

---

## 1. @ergenekon/core

**Rol**: Sıfır bağımlılıklı temel tip kütüphanesi  
**Dosyalar**: `src/types.ts`, `src/hlc.ts`, `src/ulid.ts`, `src/session-io.ts`, `src/index.ts`

### 1.1 Event Schema

Sistemin atom birimi `ErgenekonEvent`'tir. Her I/O sınır geçişi bir event üretir.

```typescript
interface ErgenekonEvent {
  id: string;                    // ULID — zaman sıralı, URL-safe
  traceId: string;               // W3C Trace ID — servisleri bağlar
  spanId: string;                // Bu operation'ın ID'si
  parentSpanId: string | null;   // Causal parent (cross-service)
  hlc: HLCTimestamp;             // Hybrid Logical Clock — global sıralama
  wallClock: number;             // ms — insan okunabilir zaman
  type: EventType;               // 15 tip (aşağıda)
  serviceName: string;           // Üreten servis
  operationName: string;         // "POST /api/orders", "Date.now()", ...
  sequence: number;              // Session içi sıra numarası
  data: Record<string, unknown>; // Yakalanan payload
  durationMs: number;            // İşlem süresi (anlık event'ler için 0)
  error: ErrorInfo | null;       // Hata bilgisi
  tags: Record<string, string>;  // Özel etiketler
}
```

### 1.2 Hybrid Logical Clock (HLC)

Distributed sistemlerde NTP gerektirmeden causal ordering sağlar.

```
Algoritma (Kulkarni et al., 2014):
  send(msg):
    l = max(l, physical_time)
    c = c + 1  // counter artır
    return {wallTime: l, logical: c, nodeId: n}

  receive(msg, remote):
    l = max(l_local, l_remote, physical_time)
    c = (l == l_local == l_remote) ? max(c_local, c_remote) + 1
      : (l == l_local) ? c_local + 1
      : (l == l_remote) ? c_remote + 1
      : 0

Garanti:
  Eğer A → B (A, B'den önce olduysa):
  HLC(A) < HLC(B) HER ZAMAN
```

**Kritik Tasarım**: HLC constructor'ında `_rawDateNow = Date.now.bind(Date)` ile orijinal referans yakalanır. Bu sayede probe monkey-patch'leri HLC'yi etkilemez.

### 1.3 ULID

Zaman-sıralı benzersiz ID. `01HWXYZ...` formatında — timestamp prefix + random suffix.

```
01HW  XYZ  ABC  DEF  GHI  JKL  MNO
─────────  ──────────────────────────
48-bit     80-bit
timestamp  random
(ms)       (Crockford Base32)
```

Avantaj: Lexicographic sıralama = zaman sıralaması. DB indexleme için idealdir.

### 1.4 Session Import/Export (session-io.ts)

İki format desteklenir:

**JSON Format** — insan okunabilir, debug için:
```json
{
  "_format": "ergenekon-session-v1",
  "_exportedAt": 1712345678901,
  "session": { "id": "...", "events": [...] }
}
```

**Binary PRDX Format** — kompakt, production için:
```
Byte  0-3:   "PRDX" magic bytes
Byte  4-5:   Version (uint16BE) = 1
Byte  6-9:   Metadata gzip length (uint32BE)
Byte 10-N:   Metadata JSON (gzip compressed)
Byte N+1-4:  Event count (uint32BE)
Byte N+5-8:  Events gzip length (uint32BE)
Byte N+9-M:  Events JSON (gzip compressed)
Byte M+1-4:  CRC32 checksum (uint32BE)
```

- ~24% compression (gzip)
- CRC32 ile integrity check
- Magic bytes ile format tespiti
- Roundtrip guaranteed: export → import → byte-for-byte identical

---

## 2. @ergenekon/probe

**Rol**: Uygulamaya yerleştirilen "kamera" — sıfır config ile her I/O'yu yakalar  
**Ana Dosya**: `src/index.ts` → `ErgenekonProbe` sınıfı

### 2.1 Başlatma Sırası

```
ErgenekonProbe constructor
    │
    ├── HybridLogicalClock oluştur
    ├── CollectorClient oluştur
    └── SamplingEngine oluştur

probe.middleware() çağrılınca:
    │
    ├── installGlobalInterceptors()     → Date.now, Math.random
    ├── installFetchInterceptor()       → globalThis.fetch
    ├── installTimerInterceptors()      → setTimeout, setInterval, randomUUID
    ├── installErrorInterceptors()      → uncaughtException, console
    ├── installPgInterceptor()          → pg.Client/Pool (varsa)
    ├── installRedisInterceptor()       → ioredis (varsa)
    ├── installMongoInterceptor()       → mongoose (varsa)
    └── collector.start()              → flush timer başlat
```

### 2.2 internal-clock.ts — Kritik Tasarım

```typescript
// Bu dosya HER ŞEYDEN ÖNCE yüklenir.
// Date.now ve Math.random henüz patched DEĞİL.
export const originalDateNow = Date.now.bind(Date);
export const originalMathRandom = Math.random.bind(Math);
```

**Neden gerekli?**
- `recording-context.ts` event timestamp için `originalDateNow` kullanır
- HLC `originalDateNow` kullanır
- `globals.ts` patch yaparken bu referansları kullanır
- Circular import (`globals.ts` ↔ `recording-context.ts`) bu dosya ile çözülür

### 2.3 Re-Entrancy Guard

```typescript
// globals.ts
let _recording = false;

Date.now = function ergenekonDateNow(): number {
  const value = _originalDateNow();   // Her zaman çalışır
  if (_recording) return value;       // ← GUARD: iç çağrıda kayıt yapma

  const session = getActiveSession();
  if (!session) return value;         // Aktif session yoksa geç

  _recording = true;                  // ← Kilidi al
  try {
    session.record('timestamp', 'Date.now()', { value });
  } finally {
    _recording = false;               // ← Her zaman kilidi bırak
  }
  return value;
};
```

**Problem çözüldü**: `record()` → `ulid()` → `Date.now()` → `record()` sonsuz döngü.

### 2.4 AsyncLocalStorage ile Context Propagation

```typescript
// recording-context.ts
const storage = new AsyncLocalStorage<RecordingSession>();

// http-incoming.ts (middleware)
runWithSession(session, () => next());
// ↑ Bu çağrıdan sonra tüm async operasyonlar (await, callback, Promise)
//   aynı session'ı görür — herhangi bir global state kirlenmez.

// globals.ts (Date.now patch)
const session = getActiveSession();
// ↑ Bu request'e ait session — thread-safe, request-isolated
```

### 2.5 Smart Sampling Engine (sampling.ts)

**Tasarım prensibi**: Tail-based sampling — buffer et, sonuç görünce karar ver.

```
Request geldi
    │
    ▼
HEAD DECISION (hızlı, request başında)
├── upstream sampled? → EVET kaydet (reason: upstream)
├── adaptive active?  → EVET kaydet (reason: adaptive)
├── new path?         → EVET kaydet (reason: new_path)
├── random < rate?    → EVET kaydet (reason: random)
└── default           → HAYIR (ama buffer'la)

Request bitti
    │
    ▼
TAIL DECISION (HEAD "hayır" dediyse bile)
├── statusCode >= 500? → UPGRADE: kaydet (reason: error)
├── durationMs > P99?  → UPGRADE: kaydet (reason: latency)
└── HEAD "evet" ise    → değiştirme

Adaptive Trigger:
  Son 1 dakikada error rate > %5?
  → adaptiveOverride = true (30 saniye boyunca %100 sample)
```

**Path Normalization**:
```
/api/users/123        → /api/users/:id
/api/users/abc-def    → /api/users/:id  (hex ID)
/api/orders/ORD-X7Y2  → /api/orders/:id (business ID)
/api/data?page=2      → /api/data       (query strip)
```

Bu sayede `/api/users/:id` bir kez görüldü sayılır, her user ID için ayrı `new_path` tetiklenmez.

### 2.6 Deep Field Redaction (redaction.ts)

```typescript
// Hiçbir zaman orijinal objeyi MUTATE etmez — deep copy döner
export function redactDeep(obj: unknown, config?: Partial<RedactionConfig>): unknown

// 3 katmanlı kontrol:
// 1. Alan adı eşleşmesi (case-insensitive):
//    "password", "secret", "token", "creditCard", "ssn", ...
//
// 2. Glob path pattern:
//    "user.*.password" → "user.profile.password" eşleşir
//    "headers.**"      → tüm alt alanlar
//
// 3. Değer içeriği auto-detect:
//    /^eyJ[a-zA-Z0-9_-]+\.eyJ...$/    → JWT
//    /^\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}$/  → Credit card
//    /^Bearer\s+.{20,}$/               → Bearer token
//    /^AKIA[0-9A-Z]{16}$/              → AWS access key
//    /-----BEGIN.*PRIVATE KEY-----/    → PEM private key
```

### 2.7 HTTP Incoming Middleware (http-incoming.ts)

```
Request → ergenekonMiddleware
    │
    ├── enabled? sampling? → karar ver
    │
    ├── traceparent header parse → traceId al / yeni üret
    │
    ├── x-ergenekon-hlc header → HLC.receive() → distributed clock sync
    │
    ├── RecordingSession oluştur
    │
    ├── http_request_in event kaydet (redacted)
    │
    ├── res.end() override et (response capture için)
    │
    └── runWithSession(session, () => next())
              │
              ▼ (uygulama kodu çalışır)
              │
    res.end() tetiklenir
              │
              ├── response body capture
              ├── http_response_out event kaydet (redacted)
              ├── TAIL sampling kararı
              ├── session.finalize()
              └── collector.enqueue(session)
```

### 2.8 HTTP Outgoing Interceptor (http-outgoing.ts)

```typescript
globalThis.fetch = async function ergenekonFetch(input, init): Promise<Response> {
  const session = getActiveSession();
  if (!session) return _originalFetch(input, init); // zero overhead

  // 1. http_request_out kaydet
  // 2. traceparent header enjekte et
  // 3. x-ergenekon-hlc header enjekte et
  // 4. _originalFetch çağır
  // 5. Response klonla (body stream bir kez okunabilir)
  // 6. http_response_in kaydet
  // 7. Klonu döndür (uygulama okuyabilir)
};
```

---

## 3. @ergenekon/collector

**Rol**: Merkezi kayıt deposu  
**Dosyalar**: `src/server.ts`, `src/storage.ts`, `src/index.ts`

### 3.1 REST API

```
POST /api/v1/sessions     → Probe'dan session al, dosyaya yaz
GET  /api/v1/sessions     → Tüm sessionların özeti (events yok)
GET  /api/v1/sessions/:id → Tek session tüm detayıyla
GET  /api/v1/traces/:id   → traceId ile ilişkili tüm sessionlar
GET  /api/v1/stats        → İstatistikler
GET  /health              → Sağlık kontrolü
```

### 3.2 File Storage Yapısı

```
.ergenekon-recordings/
├── sessions/
│   ├── 01HWXYZ123ABC.json    ← Her session ayrı JSON dosyası
│   ├── 01HWXYZ456DEF.json
│   └── ...
└── index/                    ← Gelecek: CAS index
```

**In-memory index** (startup'ta disk'ten yeniden inşa edilir):
```typescript
sessionIndex: Map<sessionId, filename>   // O(1) lookup
traceIndex:   Map<traceId, sessionId[]>  // trace assembly
```

### 3.3 Tasarım Kararları

- Framework yok (pure Node.js HTTP) — bağımlılık sıfır
- CORS headers built-in (UI erişimi için)
- Graceful shutdown: `server.close()` + `Promise`
- Gelecek: gRPC ingestion, Rust rewrite, CAS deduplication

---

## 4. @ergenekon/replay

**Rol**: Deterministik replay motoru  
**Dosyalar**: `src/mock-layer.ts`, `src/replay-engine.ts`, `src/index.ts`

### 4.1 MockLayer — I/O Replacement

```typescript
class MockLayer {
  private cursor = 0;           // Sıralı event okuyucu
  private typeQueues: Map<EventType, ErgenekonEvent[]>; // Tip bazlı kuyruklar

  mockDateNow(): number        → cursor'dan sonraki timestamp event'i al
  mockMathRandom(): number     → cursor'dan sonraki random event'i al
  mockFetch(url): Response     → cursor'dan sonraki http_response_in'i al
  mockDbQuery(sql): unknown    → cursor'dan sonraki db_result'u al
  mockRedisCommand(): unknown  → cursor'dan sonraki cache event'i al
  mockRandomUUID(): string     → cursor'dan sonraki uuid event'i al

  seekTo(sequence): void       → cursor'u belirli bir noktaya at (time-travel)
}
```

**Divergence Detection**:
```typescript
if (actual_url !== recorded_url) {
  throw new ReplayDivergenceError(
    'http_request_out',     // event type
    actual_url,             // replay'de ne çağrıldı
    recorded_url,           // kayıtta ne vardı
    'URL mismatch'          // açıklama
  );
}
```

### 4.2 ReplayEngine — Time-Travel API

```typescript
class ReplayEngine {
  getTimeline(): TimelineEntry[]
  // → Tüm event'lerin özeti: sequence, type, operation, timing

  getStateAt(sequence: number): ReplayState
  // → O anki sistem durumu: events[0..sequence], progress %

  getDiff(from: number, to: number): ReplayDiff
  // → İki nokta arasındaki değişiklikler

  replay(handler): Promise<unknown>
  // → MockLayer kurar, handler'ı çalıştırır, mock'ları temizler
}
```

### 4.3 Deterministik Replay Teorisi

Node.js single-threaded'dır — thread scheduling non-determinizmi yoktur.

```
Non-determinizm kaynakları + ERGENEKON çözümleri:

┌──────────────────────┬──────────────────────────────────────┐
│  Kaynak              │  Çözüm                               │
├──────────────────────┼──────────────────────────────────────┤
│  Date.now()          │  Kaydedilen değeri döndür            │
│  Math.random()       │  Kaydedilen değeri döndür            │
│  crypto.randomUUID() │  Kaydedilen değeri döndür            │
│  DB queries          │  Kaydedilen result'ı döndür          │
│  HTTP responses      │  Kaydedilen response'u döndür        │
│  Timer fire order    │  Kaydedilen sırayı takip et          │
│  External API state  │  Kaydedilen response'u döndür        │
└──────────────────────┴──────────────────────────────────────┘

Bunlar yakalanırsa: Node.js tek thread → deterministik ✓
```

---

## 5. @ergenekon/ui

**Rol**: Dark theme time-travel web arayüzü  
**Dosyalar**: `src/server.ts`, `src/public/index.html`, `src/public/styles.css`, `src/public/app.js`

### 5.1 Bileşenler

```
┌─────────────────────────────────────────────────────┐
│  Header: logo + bağlantı durumu                     │
├──────────────┬──────────────────────────────────────┤
│              │  Session Header (ID, servis, süre)   │
│ Session      ├──────────────────────────────────────┤
│ Listesi      │  Timeline (event marker'lar)          │
│              │  ← → Space Home/End ile navigate      │
│ Arama        ├──────────────────────────────────────┤
│              │  Service Flow Diagram                 │
│ [session1]   │  (ok diyagramı, servisler arası)      │
│ [session2]   ├──────────────────────────────────────┤
│ [session3]   │  Event Listesi (filtrelenebilir)      │
│ ...          ├────────────────────┬─────────────────┤
│              │  Event Listesi     │  Event Detayı   │
│              │  HTTP events       │  JSON syntax    │
│              │  DB events         │  highlighting   │
│              │  Random events     │                 │
└──────────────┴────────────────────┴─────────────────┘
```

### 5.2 Renk Kodlaması

| Event Grubu | Renk | Tipler |
|-------------|------|--------|
| HTTP In | Mavi | `http_request_in`, `http_response_out` |
| HTTP Out | Cyan | `http_request_out`, `http_response_in` |
| Database | Yeşil | `db_query`, `db_result`, `cache_get`, `cache_set` |
| Random/Time | Sarı | `timestamp`, `random`, `uuid` |
| Timer | Mor | `timer_set`, `timer_fire` |
| Error | Kırmızı | `error` |

### 5.3 Keyboard Shortcuts

| Kısayol | Eylem |
|---------|-------|
| `←` / `→` veya `j` / `k` | Önceki/sonraki event |
| `Space` | Oynat/durdur |
| `Home` | İlk event'e git |
| `End` | Son event'e git |

---

## 6. @ergenekon/cli

**Rol**: 10-komutluk ANSI renkli terminal aracı  
**Dosya**: `src/index.ts`

### 6.1 Mimari

```
CLI Entry (#!/usr/bin/env node)
    │
    ▼
main() → args parse
    │
    ▼
Command Router (switch)
    │
    ├── sessions  → GET /api/v1/sessions → tablo formatla → yazdır
    ├── inspect   → GET /api/v1/sessions/:id → detay formatla
    ├── timeline  → GET /api/v1/sessions/:id → ASCII timeline
    ├── trace     → GET /api/v1/traces/:id → ASCII Gantt
    ├── export    → GET session → JSON/binary dosyaya yaz
    ├── import    → dosyadan oku → POST /api/v1/sessions
    ├── stats     → GET /api/v1/stats → tablo
    ├── watch     → poll loop (2sn) → yeni session'ları yaz
    ├── health    → GET /health → OK/FAIL
    └── help      → yardım metni
```

### 6.2 Environment Variables

```bash
ERGENEKON_COLLECTOR_URL=http://localhost:4380  # varsayılan
```

---

## Kritik Tasarım Kararları (ADR'lar)

### ADR-001: Monkey-Patching vs. Instrumentation Library
**Karar**: Monkey-patching  
**Gerekçe**: Sıfır-config entegrasyon. Kullanıcı kodu değişmez.  
**Trade-off**: Node.js globals'i kirletir. `uninstall*` fonksiyonları ile temizlenir.

### ADR-002: AsyncLocalStorage vs. Global State
**Karar**: AsyncLocalStorage  
**Gerekçe**: Request isolation. Birden fazla concurrent request güvenle handle edilir.  
**Trade-off**: Node.js v12+ gerektirir (zaten v20+ zorunlu).

### ADR-003: ESM vs. CommonJS
**Karar**: ESM (type: module)  
**Gerekçe**: Geleceğin Node.js ekosistemi. Tree-shaking desteği.  
**Trade-off**: `require()` kullanan eski paketlerle compat sorunu → `createRequire` ile çözüldü.

### ADR-004: File Storage vs. Database (Phase 0)
**Karar**: File-based JSON  
**Gerekçe**: Sıfır bağımlılık, hızlı başlangıç, kolay debug.  
**Trade-off**: Scale etmez. Phase 4'te CAS + tiered storage gelecek.

### ADR-005: Tail-Based Sampling vs. Head-Based
**Karar**: Hybrid (Head + Tail)  
**Gerekçe**: Head hız için, Tail doğruluk için. Hataları ASLA kaçırma.  
**Trade-off**: Her request için buffer gerekir. Ring buffer ile yönetilir.

### ADR-006: TypeScript Strict Mode
**Karar**: Strict: true  
**Gerekçe**: Runtime hataları compile time'a çek. Tip güvenliği.  
**Trade-off**: Monkey-patching kodlarında bazı yerlerde `any` cast gerekir.

### ADR-007: Sıfır Bağımlılık (core)
**Karar**: @ergenekon/core sıfır npm bağımlılığı  
**Gerekçe**: Her pakete eklenir, supply chain riski minimum olmalı.  
**Trade-off**: gzip, CRC32 gibi şeyler sıfırdan yazıldı.
