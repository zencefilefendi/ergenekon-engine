# PARADOX Engine — Teknik Derinlik Dokumani

## 1. Deterministic Replay Teorisi

### Temel Prensip

Bir program **deterministik** calisir eger tum **non-determinizm kaynaklari** kontrol altindaysa.

Non-determinizm kaynaklari:
```
1. Zaman         → Date.now(), performance.now()
2. Rastgelelik   → Math.random(), crypto.randomBytes()
3. I/O           → Network, Disk, Database
4. Concurrency   → Thread scheduling, async ordering
5. Environment   → env vars, config files, OS signals
```

**Anahtar icgoru**: Bu kaynaklarin HEPSI I/O boundary'lerinde olusur. Uygulama kodunun kendisi (CPU computation) deterministiktir. Bu nedenle sadece I/O boundary'lerini yakalamak yeterlidir.

Bu, rr'nin yaklasiminin application-level karsiligi:
- rr: syscall seviyesinde yakalama (ptrace)
- PARADOX: runtime seviyesinde yakalama (monkey-patching + middleware)

### Replay Dogrulugu Kaniti

```
Tanim: Bir replay DOGRU'dur eger:
  replay(recording(execution)) ≡ execution

Yani replay'in urettigi tum ara state'ler ve
ciktilar, orijinal execution ile BIREBiR AYNI.

Ispat stratejisi:
1. Node.js single-threaded (event loop) → thread scheduling non-determinizmi YOK
2. Tum I/O boundary'leri intercept ediliyor → external non-determinizm YOK
3. Date.now/Math.random intercept ediliyor → internal non-determinizm YOK
4. Async operations event loop sirasinda calisir → sira kaydi ILE kaydediliyor
∴ Replay deterministiktir. ∎
```

### Node.js Avantaji

Node.js'in single-threaded event loop modeli, replay icin IDEAL:
- Thread scheduling problemi yok
- Tum async operasyonlar event loop uzerinden gecer
- Event loop'un sirasi deterministik (microtask → macrotask)

Bu nedenle Node.js ile baslamak stratejik bir karar.

---

## 2. Hybrid Logical Clock (HLC) Detaylari

### Neden Fiziksel Saat Yetmiyor?

```
Senaryo:
  Service A (saat: 100ms) → Service B'ye request gonderir
  Service B (saat: 98ms)  → Request'i alir

  B'nin saati geri! B'deki event, A'daki event'ten
  ONCE gorunur — ama aslinda SONRA oldu.

  NTP bunu ~1ms dogrulukla cozer ama:
  - Microsecond-level olaylarda yetersiz
  - Network partition'da NTP calismaz
  - Cloud VM'lerde saat kaymasi (clock drift) yaygin
```

### HLC Algoritmasi

```rust
struct HLC {
    wall_time: u64,      // max(local_wall, remote_wall, system_clock)
    logical: u32,        // causality counter
    node_id: String,     // unique node identifier
}

impl HLC {
    // Yerel event olusturuldiginda
    fn local_event(&mut self) -> HLCTimestamp {
        let now = system_clock();
        if now > self.wall_time {
            self.wall_time = now;
            self.logical = 0;
        } else {
            self.logical += 1;
        }
        self.timestamp()
    }

    // Baska bir node'dan mesaj alindiginda
    fn receive_event(&mut self, remote: &HLCTimestamp) -> HLCTimestamp {
        let now = system_clock();
        if now > self.wall_time && now > remote.wall_time {
            self.wall_time = now;
            self.logical = 0;
        } else if self.wall_time == remote.wall_time {
            self.logical = max(self.logical, remote.logical) + 1;
        } else if remote.wall_time > self.wall_time {
            self.wall_time = remote.wall_time;
            self.logical = remote.logical + 1;
        } else {
            self.logical += 1;
        }
        self.timestamp()
    }
}
```

### HLC Garantisi

```
Eger A → B (A causally precedes B) ise:
  HLC(A) < HLC(B) HER ZAMAN

Bu, Lamport clock'un garantisi + fiziksel saat yakinligi.
Event'ler hem NEDENSEL hem de ZAMANSAL olarak siralanabilir.
```

---

## 3. Content-Addressable Storage (CAS) Detaylari

### Veri Yapisi

```
Storage Layout:
  /objects/
    /a1/b2c3d4...  → blob data (compressed)
    /e5/f6g7h8...  → blob data (compressed)
  /sessions/
    /session-001.idx  → event index (event_id → object_hash mapping)
    /session-002.idx
  /index/
    /by-trace/     → trace_id → session_id mapping
    /by-service/   → service_name → session_ids mapping
    /by-time/      → time_range → session_ids mapping
```

### Deduplication Etkisi

```
Tipik bir uygulama icin:

  Request sayisi/gun:     1,000,000
  Ortalama event/request: 20
  Ortalama event boyutu:  2KB
  Ham veri:               1M × 20 × 2KB = 40GB/gun

  CAS deduplication sonrasi:
  - HTTP response'larin %60'i tekrar eder → %60 tasarruf
  - DB sonuclarinin %40'i tekrar eder → %40 tasarruf
  - Header'lar neredeyse hep ayni → %95 tasarruf

  Beklenen deduplication orani: %70-85
  Gercek depolama: 40GB × 0.25 = ~10GB/gun

  + LZ4 compression: ~3-4GB/gun
```

---

## 4. Smart Sampling Stratejisi

Her request'i kaydetmek gereksiz ve pahalı. Akilli ornekleme:

### Sampling Kuralları (Oncelik Sirasina Gore)

```
1. ERROR sampling: Hata donen her request MUTLAKA kaydedilir     → %100
2. LATENCY sampling: P99'u asan requestler kaydedilir            → %100
3. NEW PATH sampling: Ilk kez gorulen endpoint/path kaydedilir   → %100
4. TRACE sampling: Upstream servisten "sample" flag'i geldiyse    → %100
5. RANDOM sampling: Geri kalan requestlerden rastgele orne al     → %1-5 (configurable)
```

### Head-Based vs Tail-Based Sampling

```
Head-Based (karar basta):
  Request geldiginde kaydet/kaydetme karari ver.
  + Basit, dusuk overhead
  - Ilginc request'leri kacirabilir (hata sonda olusur)

Tail-Based (karar sonda):
  Her seyi buffer'a yaz, request bitince kaydet/sil karari ver.
  + Hatalı request'leri ASLA kacirmaz
  - Daha fazla memory kullanir

PARADOX: HYBRID yaklasim
  1. Her seyi kisa sureli ring buffer'a yaz (son 30sn)
  2. Request basarili biterse → sampling kuralina bak
  3. Request hatali biterse → MUTLAKA kalici storage'a tasi
```

---

## 5. Probe Intercept Mekanizmalari

### HTTP Incoming (Express/Fastify/Koa)

```typescript
// Express middleware olarak
function paradoxMiddleware(req, res, next) {
  const session = new RecordingSession({
    traceId: extractTraceId(req) || generateTraceId(),
    spanId: generateSpanId(),
    serviceName: config.serviceName,
  });

  // Request'i kaydet
  session.recordEvent({
    type: 'http_request_in',
    data: {
      method: req.method,
      url: req.url,
      headers: sanitizeHeaders(req.headers),  // auth token'lari maskele
      body: req.body,
    }
  });

  // Context'i async_hooks ile tasit
  asyncLocalStorage.run(session, () => {
    // Response'u intercept et
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
      session.recordEvent({
        type: 'http_response_out',
        data: {
          statusCode: res.statusCode,
          headers: res.getHeaders(),
          body: chunk,
        }
      });

      session.finish();
      return originalEnd.call(this, chunk, encoding);
    };

    next();
  });
}
```

### HTTP Outgoing (fetch/axios/http)

```typescript
// Global fetch intercept
const originalFetch = globalThis.fetch;
globalThis.fetch = async function(url, options) {
  const session = asyncLocalStorage.getStore();
  if (!session) return originalFetch(url, options);

  session.recordEvent({
    type: 'http_request_out',
    data: { url: url.toString(), options: sanitize(options) }
  });

  const response = await originalFetch(url, options);
  const body = await response.clone().text();

  session.recordEvent({
    type: 'http_response_in',
    data: {
      status: response.status,
      headers: Object.fromEntries(response.headers),
      body,
    }
  });

  return response;
};
```

### Database (pg, mysql2, mongoose)

```typescript
// PostgreSQL (pg) intercept
const originalQuery = pg.Client.prototype.query;
pg.Client.prototype.query = function(...args) {
  const session = asyncLocalStorage.getStore();
  if (!session) return originalQuery.apply(this, args);

  const queryText = typeof args[0] === 'string' ? args[0] : args[0].text;
  const queryValues = typeof args[0] === 'string' ? args[1] : args[0].values;

  session.recordEvent({
    type: 'db_query',
    data: { engine: 'postgresql', query: queryText, values: queryValues }
  });

  const result = originalQuery.apply(this, args);

  if (result instanceof Promise) {
    return result.then(res => {
      session.recordEvent({
        type: 'db_result',
        data: { rows: res.rows, rowCount: res.rowCount }
      });
      return res;
    });
  }

  return result;
};
```

---

## 6. Replay Mock Layer

Replay sirasinda tum I/O cagrilari mock'lanir:

```typescript
class ReplayMockLayer {
  private eventQueue: Map<EventType, ParadoxEvent[]>;
  private position: number = 0;

  // Date.now() replay'de
  mockDateNow(): number {
    const event = this.nextEvent('timestamp');
    return event.data.value;
  }

  // Math.random() replay'de
  mockMathRandom(): number {
    const event = this.nextEvent('random');
    return event.data.value;
  }

  // fetch() replay'de
  async mockFetch(url: string): Promise<Response> {
    const event = this.nextEvent('http_response_in');
    return new Response(event.data.body, {
      status: event.data.status,
      headers: event.data.headers,
    });
  }

  // db.query() replay'de
  async mockDbQuery(query: string): Promise<QueryResult> {
    const event = this.nextEvent('db_result');
    return { rows: event.data.rows, rowCount: event.data.rowCount };
  }

  private nextEvent(type: EventType): ParadoxEvent {
    // Siradaki event'i dondur — SIRASI ONEMLI
    const events = this.eventQueue.get(type);
    if (!events || events.length === 0) {
      throw new ReplayDivergenceError(
        `Expected ${type} event but none left — kod degismis olabilir`
      );
    }
    return events.shift()!;
  }
}
```

---

## 7. Performans Hedefleri

| Metrik | Hedef | Olcum Yontemi |
|--------|-------|---------------|
| Probe CPU overhead | <%1 | Benchmark: with/without probe |
| Probe memory overhead | <%5 (50MB max) | RSS olcumu |
| Probe latency overhead | <0.5ms/request | P99 latency farki |
| Collector throughput | >1M event/sn | Load test |
| Collector ingestion latency | <10ms | gRPC stream latency |
| Storage deduplication | >%70 | Stored/raw ratio |
| Replay startup | <2sn | Time to first event |
| Time-travel seek | <100ms | Any point in session |

---

## 8. Gelecek: Multi-Language Support

Phase 1 (Simdi): Node.js/TypeScript
Phase 2: Python (Django/Flask/FastAPI)
Phase 3: Go
Phase 4: Java/Kotlin (Spring Boot)
Phase 5: Rust

Her dil icin probe farkli olacak ama protocol ve collector AYNI.
Bu, protobuf-based event schema ile saglaniyor.
