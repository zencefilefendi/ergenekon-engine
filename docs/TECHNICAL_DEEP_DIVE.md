# PARADOX Engine — Teknik Derinlik Analizi

Bu belge PARADOX Engine'in teorik temellerini, algoritma detaylarını ve kanıtlanmış teknik tasarım kararlarını açıklar.

---

## 1. Deterministik Replay Teorisi

### Temel Önerme

> **Teorem**: Node.js uygulamaları, tüm I/O sınır değerleri sabit tutulduğunda deterministik şekilde tekrar çalıştırılabilir.

### Kanıt

Node.js çalışma modeli:

1. **Tek thread**: JavaScript execution single-threaded'dır. Thread scheduling non-determinizmi yoktur.
2. **Event loop**: Async operasyonlar (I/O, timer) event loop kuyruğuna girer. Sıra deterministik.
3. **Shared mutable state yok**: Her request'in kendi async context'i vardır (AsyncLocalStorage).

Non-determinizm sadece şuralardan gelir:
- Dış dünyadan okunan değerler (DB, HTTP, zaman, rastgele sayı)
- Bunların hepsi I/O sınırında yakalanabilir.

Tüm I/O sınır değerleri kaydedilip aynı sırayla sunulursa → **identik output garantilenmiştir**.

### Kanıtlanmış Sonuç

```
MÜKEMMEL REPLAY — BYTE-FOR-BYTE AYNI

Phase 0: 23 event → requestId birebir aynı ✓
Phase 1: 98 event (2 servis) → tüm değerler birebir aynı ✓
```

---

## 2. Hybrid Logical Clock (HLC)

### Problem

Distributed sistemlerde "hangi event önce oldu?" sorusunu cevaplamak için fiziksel saatler yeterli değildir:

- NTP senkronizasyon hatası: ~1-10ms
- Network jitter: değişken
- Sonuç: Service A'nın `t=100ms` eventi, Service B'nin `t=99ms` eventinden ÖNCE mi oldu?

### Çözüm: HLC (Kulkarni et al., 2014)

```
Her node şunları tutar:
  l  = en son görülen maksimum fiziksel zaman
  c  = l'nin aynı olduğu durumda logical counter

Gönderim (send):
  l = max(l, physical_time())
  c = c + 1
  mesaj = {l, c, nodeId}

Alım (receive, remote_msg):
  if remote.l > l:
    l = remote.l
    c = remote.c + 1
  elif remote.l == l:
    c = max(c, remote.c) + 1
  else:
    c = c + 1

Karşılaştırma:
  HLC(a) < HLC(b) iff
    a.l < b.l  veya
    (a.l == b.l ve a.c < b.c)  veya
    (a.l == b.l ve a.c == b.c ve a.nodeId < b.nodeId)
```

**Garanti**: `A → B` (A, B'ye neden olduysa) `HLC(A) < HLC(B)` her zaman.

### PARADOX'ta HLC Kullanımı

1. Her servis kendi HLC instance'ına sahip.
2. `x-paradox-hlc` HTTP header'ı ile clock değerleri yayılır.
3. Collector, tüm servislerin eventlerini HLC sıralamasıyla düzenler.
4. Replay sırasında HLC sırası kullanılır.

```
order-service HLC: {wallTime: 100, logical: 3, nodeId: "order-abc"}
user-service  HLC: {wallTime: 98,  logical: 1, nodeId: "user-xyz"}

Fiziksel saate göre: user-service önce (98 < 100)
HLC'ye göre: order-service önce (causal — order user'ı çağırdı)

→ HLC doğru sıralamayı verir ✓
```

---

## 3. Smart Sampling Algoritması

### Problem

Production'da %100 kayıt yapılamaz:
- Her request için tam state capture: ~2-5ms overhead
- Yüksek traffic'te: 1000 RPS × 5ms = %500 CPU → kabul edilemez

Ama hataları asla kaçırmamalıyız.

### Tail-Based Sampling

```
Klasik Head-Based:
  Request gelince karar ver → kaçırılan hatalar var

Tail-Based (PARADOX):
  Her requesti buffer'la → sonucu gör → sonra karar ver

Avantaj: Hata %100 yakalanır (statusCode >= 500 → her zaman kaydet)
Dezavantaj: Buffer memory gerekir → ring buffer ile sınırlandırılır
```

### Adaptive Sampling

```
Sliding window (son 1 dakika):
  error_rate = error_count / total_count

  if error_rate > threshold (default: %5):
    adaptive_active = True
    adaptive_until = now + 30 saniye
    // Bu 30 saniye boyunca tüm requestler kaydedilir

Sonuç: Error spike sırasında tam coverage
```

### Path Normalization

URL parametrelerini normalize ederek "new path" tespitini doğru yapar:

```
Regex sırası:
1. /\d+/g           → /:id  (sayısal IDler)
2. /[0-9a-f]{8,}/gi → /:id  (UUID, hex IDler)
3. /[A-Z]{2,4}-[A-Z0-9]+/g → /:id  (ORD-XY7Z gibi business IDler)
4. /\?.*$/          → ""    (query string kaldır)

Örnekler:
/api/users/123           → /api/users/:id
/api/orders/ORD-ABC123   → /api/orders/:id
/api/data?page=2&sort=id → /api/data
```

---

## 4. Deep Redaction Algoritması

### Neden Gerekli

Production kayıtları şunları içerebilir:
- Kullanıcı şifreleri (`req.body.password`)
- JWT tokenları (`Authorization: Bearer eyJ...`)
- Kredi kartı numaraları (`"cardNumber": "4111..."`)
- AWS erişim anahtarları (`"awsKey": "AKIA..."`)

KVKK/GDPR uyumu için bunların kayıtlara girmemesi gerekir.

### Algoritma

```
redactDeep(value, config, path="", depth=0):
  if depth > maxDepth: return REPLACEMENT

  if primitive(value):
    if autoDetect && looksLikeSecret(value): return REPLACEMENT
    return value

  if Array(value):
    return value.map((v, i) => redactDeep(v, config, path+"[i]", depth+1))

  if Object(value):
    result = {}
    for key, val in value:
      childPath = path ? path+"."+key : key

      if key.lower() in fieldNames: result[key] = REPLACEMENT; continue
      if anyMatch(childPath, pathPatterns): result[key] = REPLACEMENT; continue
      if customRedactor != null: use it; continue

      result[key] = redactDeep(val, config, childPath, depth+1)
    return result

looksLikeSecret(str):
  JWT:          /^eyJ[a-zA-Z0-9_-]+\.eyJ[a-zA-Z0-9_-]+\./
  CreditCard:   /^\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}$/
  Bearer:       /^Bearer\s+.{20,}$/
  AWSKey:       /^AKIA[0-9A-Z]{16}$/
  PrivateKey:   /-----BEGIN.*PRIVATE KEY-----/
```

**Önemli**: Orijinal obje asla mutate edilmez — her zaman deep copy döner.

---

## 5. Binary PRDX Format Tasarımı

### Neden Binary?

JSON formatı insan okunabilir ama verimsizdir:
- Tekrar eden field isimleri ("traceId", "spanId", ...)
- Her event için aynı yapı → büyük overhead
- Network transfer: JSON ~2KB, binary ~0.5KB per event

### Format Şeması

```
Offset  Size   Type      Alan
------  ----   ------    --------------------------
0       4      bytes     Magic: "PRDX" (0x50524458)
4       2      uint16BE  Version: 1
6       4      uint32BE  Metadata gzip length
10      N      bytes     Metadata JSON (gzip compressed)
10+N    4      uint32BE  Event count
14+N    4      uint32BE  Events payload gzip length
18+N    M      bytes     Events JSON (gzip compressed)
18+N+M  4      uint32BE  CRC32 checksum of all above
```

### CRC32 Algoritması

```typescript
// Lookup table ile optimize edilmiş (O(n))
// Polynomial: 0xEDB88320 (IEEE 802.3)
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) {
    c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
  }
  CRC32_TABLE[i] = c;
}

function crc32(data: Buffer): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}
```

**Compression ratio** (gerçek ölçüm):
```
JSON:   551 bytes  (küçük session, 1 event)
Binary: 420 bytes
Tasarruf: %24

Büyük session (1000 event):
JSON:   ~2MB
Binary: ~600KB  (gzip etkisi belirginleşir)
Tasarruf: ~%70
```

---

## 6. Content-Addressable Storage (CAS) — Tasarlandı, Phase 5+

### Motivasyon

Aynı statik veri (kullanıcı listesi, config) farklı session'larda tekrar tekrar kaydediliyor. Deduplication ile büyük tasarruf mümkün.

### Tasarım

```
Her event'in data field'ı için SHA-256 hash hesapla:
  hash = SHA-256(JSON.stringify(event.data))
  ref  = hash[:16]  // 16 hex karakter

Depolama:
  objects/
    ab/cdef1234567890abcdef...  ← hash'in ilk 2 karakteri klasör
    cd/5678abcdef1234...

Session dosyası (büyük olmak yerine):
  {
    "events": [
      { ..., "dataRef": "abcdef1234..." },  // data yerine ref
      ...
    ]
  }
```

**Beklenen kazanım**: Benzer endpoint'leri kaydeden sistemlerde %40-60 storage tasarrufu.

---

## 7. Performans Bütçesi

### Probe Overhead Hedefleri

| Durum | Overhead | Gerekçe |
|-------|---------|---------|
| No session (interceptor kurulu, kayıt yok) | <0.01ms | Hot path: sadece `if (!session) return` |
| Session aktif, event kaydetme | ~0.1ms | Record + HLC.now() + ULID |
| HTTP request capture | ~0.5ms | JSON.stringify + copy |
| Full session finalize + async send | ~1ms | JSON.stringify + HTTP POST |

### Sampling ile Overhead Kontrolü

```
%1 sampling (baseRate: 0.01):
  100 request → 1 kayıt → 99 request'te ~0.01ms overhead
  Ortalama overhead: 0.99 × 0.01ms + 0.01 × 1ms = ~0.02ms/request

%100 sampling (baseRate: 1.0):
  Tüm requestler → ~1ms overhead/request
  1000 RPS'de: 1000ms CPU/sn = %100 bir core
  → Production'da %1 sampling önerilir
```

---

## 8. ULID Yapısı

```
01HWXYZ1234ABCDEF5678

Karakter dekompozizyonu:
  01HWXYZ12    → 48-bit timestamp (ms precision)
  34ABCDEF5678 → 80-bit cryptographically random

Crockford Base32 charset:
  0123456789ABCDEFGHJKMNPQRSTVWXYZ
  (Karışık görünen karakterler hariç: I, L, O, U)

Özellikler:
  - Lexicographic sort = zaman sıralaması
  - Case-insensitive
  - URL-safe (özel karakter yok)
  - 128-bit entropy
  - ms precision ile 32-bit timestamp aşımı: yıl 10889
```

---

## 9. W3C Trace Context Propagation

PARADOX, W3C Trace Context standardını (RFC) tam uygular:

```
traceparent header formatı:
  {version}-{traceId}-{parentId}-{flags}
  00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01

  version:  "00" (sabit)
  traceId:  32-hex UUID (128-bit) — tüm servislerde aynı
  parentId: 16-hex UUID (64-bit)  — bu servisin spanId'si
  flags:    "01" = sampled, "00" = not sampled

PARADOX eklentisi:
  x-paradox-hlc: {"wallTime":1712345678,"logical":3,"nodeId":"order-abc"}
  ← Downstream servis HLC.receive() ile kendi saatini sync eder
```

---

## 10. Replay Divergence Detection

Replay sırasında kaydedilen state ile gerçek çalışma arasında farklılık tespiti:

```typescript
// Senaryo: Replay sırasında beklenmedik fetch çağrısı
fetch('http://new-service/api/data')
  // Kayıtta bu endpoint yok!
  → throw new ReplayDivergenceError(
      'http_request_out',
      'http://new-service/api/data',  // actual
      undefined,                       // recorded (yok)
      'Unexpected fetch call — not in recording'
    )

// Senaryo: Yanlış sırada DB sorgusu
dbQuery('SELECT * FROM products')
  // Kayıtta bu noktada 'SELECT * FROM orders' bekleniyor
  → throw new ReplayDivergenceError(
      'db_query',
      'SELECT * FROM products',   // actual
      'SELECT * FROM orders',     // recorded
      'Query mismatch at sequence 7'
    )
```

Bu mekanizma, kodda bir değişiklik replay'i farklılaştırıyorsa bunu anında fark ettirir — "fix verification" için kritik.
