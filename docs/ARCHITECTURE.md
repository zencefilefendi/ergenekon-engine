# PARADOX Engine — Teknik Mimari

## Genel Bakis

PARADOX dort ana paketten olusur. Her biri bagimsiz calisabilir, birlikte guclu bir sistem olusturur.

**Mevcut Durum (Phase 0 tamamlandi)**:
- paradox-core: ✅ Calisiyor
- paradox-probe: ✅ Calisiyor (HTTP, Date.now, Math.random, fetch)
- paradox-collector: ✅ Calisiyor (HTTP REST, dosya storage)
- paradox-replay: ✅ Calisiyor (mock layer, timeline inspection)
- paradox-ui: ⏳ Planli

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
           │    HTTP/gRPC    │    HTTP/gRPC    │
           ▼                 ▼                 ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PARADOX COLLECTOR                           │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ Event        │  │ HLC          │  │ Storage      │         │
│  │ Ingestion    │──│ Ordering     │──│ Engine       │         │
│  │ (REST API)   │  │ Engine       │  │ (File JSON)  │         │
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
          │ Sessions as  │          │ MockLayer  │ │         │
          │ JSON files   │◄────────│ +Timeline  │ │ (Plan)  │
          │              │          │ Inspection │ │         │
          └──────────────┘          └────────────┘ └─────────┘

```

## Paket Detaylari

---

## 1. PARADOX CORE (`@paradox/core`)

**Dil**: TypeScript | **Bagimlilik**: Sifir | **Durum**: ✅ v0.1

Tum paketlerin paylastigi temel tipler ve yardimci araclar.

### Icerik
- **types.ts**: `ParadoxEvent`, `RecordingSession`, `ProbeConfig`, `HLCTimestamp` — sistemin DNA'si
- **hlc.ts**: Hybrid Logical Clock — distributed event ordering
- **ulid.ts**: Zaman-sirali benzersiz ID uretici (sifir bagimlilik)

### Event Schema (Cekirdek)

```typescript
interface ParadoxEvent {
  id: string;                    // ULID
  traceId: string;               // W3C Trace ID
  spanId: string;                // Operation span
  parentSpanId: string | null;   // Causal parent
  hlc: HLCTimestamp;             // Hybrid Logical Clock
  wallClock: number;             // Human-readable time
  type: EventType;               // 'http_request_in' | 'timestamp' | 'random' | ...
  serviceName: string;           // Source service
  operationName: string;         // Human-readable op name
  sequence: number;              // Order within session
  data: Record<string, unknown>; // Captured payload
  durationMs: number;            // Operation duration
  error: ErrorInfo | null;       // Error if any
  tags: Record<string, string>;  // Custom tags
}
```

### HLC Garantisi
```
Eger A → B (A, B'den once olustuysa):
  HLC(A) < HLC(B) HER ZAMAN GARANTILI

Constructor'da raw Date.now referansi capture edilir:
  const _rawDateNow = Date.now.bind(Date);
Bu sayede monkey-patched Date.now ile interferans OLMAZ.
```

---

## 2. PARADOX PROBE (`@paradox/probe`)

**Dil**: TypeScript | **Durum**: ✅ v0.1

### Mimari

```
  Express Request
       │
       ▼
┌──────────────────────┐
│ http-incoming.ts     │ → RecordingSession olustur
│ (Express middleware)  │ → AsyncLocalStorage'a koy
└──────┬───────────────┘
       │
       ▼ (AsyncLocalStorage propagation)
┌──────────────────────┐
│ Application Code     │
│                      │
│ Date.now() ─────────────→ globals.ts → session.record('timestamp')
│ Math.random() ──────────→ globals.ts → session.record('random')
│ fetch() ────────────────→ http-outgoing.ts → session.record('http_*')
│                      │
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ http-incoming.ts     │ → res.end() intercept
│ (response capture)   │ → session.finalize()
└──────┬───────────────┘
       │
       ▼
┌──────────────────────┐
│ collector-client.ts  │ → Buffer + batch send
└──────────────────────┘
```

### Kritik Tasarim Kararlari

**1. Re-Entrancy Guard**
```
Problem: session.record() → ulid() → Date.now() → session.record() → SONSUZ DONGU

Cozum: _recording flag
  Date.now = () => {
    const value = _originalDateNow();
    if (_recording) return value;  // Guard: ic cagrilarda kayit yapma
    _recording = true;
    try { session.record(...) }
    finally { _recording = false; }
    return value;
  }
```

**2. Internal Clock Isolation**
```
Problem: Circular import: globals.ts ↔ recording-context.ts

Cozum: internal-clock.ts (bagimsiz modul)
  // Module yukleme aninda, TUM patching'den ONCE capture edilir
  export const originalDateNow = Date.now.bind(Date);
  export const originalMathRandom = Math.random.bind(Math);
```

**3. AsyncLocalStorage Context Propagation**
```
Her request icin bir RecordingSession olusturulur.
AsyncLocalStorage sayesinde tum async operasyonlar
(db query, fetch, setTimeout) ayni session'a baglanir.
Hicbir global state kirlenmez — her request izole.
```

### Mevcut Interceptor'lar
| Interceptor | Dosya | Yakalanan |
|-------------|-------|-----------|
| HTTP Incoming | http-incoming.ts | Request method/url/headers/body, Response status/headers/body |
| HTTP Outgoing | http-outgoing.ts | fetch() calls — request + response |
| Date.now() | globals.ts | Her cagrinin dondurulan degeri |
| Math.random() | globals.ts | Her cagrinin dondurulan degeri |

### Phase 1'de Eklenecek Interceptor'lar
| Interceptor | Hedef | Yaklasim |
|-------------|-------|----------|
| PostgreSQL | pg.Client.query | Prototype monkey-patch |
| Redis | ioredis commands | Command-level intercept |
| setTimeout | global setTimeout | Wrapper + timing capture |
| crypto.randomUUID | crypto module | Function replacement |
| Error | process events | uncaughtException/unhandledRejection |

---

## 3. PARADOX COLLECTOR (`@paradox/collector`)

**Dil**: TypeScript (Phase 0), Rust (Phase 2+) | **Durum**: ✅ v0.1

### REST API

| Method | Path | Aciklama |
|--------|------|----------|
| POST | /api/v1/sessions | Probe'lardan recording al |
| GET | /api/v1/sessions | Tum session'lari listele |
| GET | /api/v1/sessions/:id | Tek session detayi |
| GET | /api/v1/traces/:traceId | Trace'e ait tum session'lar |
| GET | /api/v1/stats | Collector istatistikleri |
| GET | /health | Saglik kontrolu |

### Storage (Phase 0)
```
.paradox-recordings/
├── sessions/
│   ├── 01ABC123DEF456.json    # Her session ayri dosya
│   ├── 01ABC789GHI012.json
│   └── ...
└── index/                      # (Gelecek: CAS index)
```

---

## 4. PARADOX REPLAY (`@paradox/replay`)

**Dil**: TypeScript | **Durum**: ✅ v0.1

### MockLayer — I/O Replacement

```
Recording sirasinda:              Replay sirasinda:
  Date.now() → 1712345678        Date.now() → MockLayer → 1712345678 (recorded)
  Math.random() → 0.7342          Math.random() → MockLayer → 0.7342 (recorded)
  fetch(url) → {data: ...}       fetch(url) → MockLayer → {data: ...} (recorded)
```

### Timeline Inspection (Time-Travel Foundation)

```typescript
// Herhangi bir noktadaki durumu sor
engine.getStateAt(sequence: 5)
// → { events: [E0..E5], currentEvent: E5, progress: 0.25 }

// Iki nokta arasindaki farki gor
engine.getDiff(fromSequence: 2, toSequence: 8)
// → { added: [E3, E4, E5, E6, E7, E8], range: [2, 8] }

// Tam timeline
engine.getTimeline()
// → [{ sequence, type, operation, wallClock, data, durationMs }, ...]
```

---

## Guvenlik Notlari

- Probe varsayilan olarak `authorization`, `cookie`, `x-api-key` header'larini maskeler
- Body field maskeleme konfigurasyonla ayarlanabilir
- Collector ile probe arasinda TLS zorunlu (production'da)
- Storage encryption at rest (Phase 4)
- RBAC: Kim hangi recording'i gorebilir (Phase 4)
- KVKK/GDPR uyumlu data retention (Phase 4)
