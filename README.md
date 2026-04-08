# PARADOX Engine

**Distributed Systems Time-Travel Debugger**

> Production'da olusan her bug'i birebir tekrar uret, zamanda geri git, ileri sar, kodu degistir, ayni senaryoyu tekrar calistir.

## Problem

Modern yazilim dunyasinin en buyuk cozulmemis problemi: **production debugging.**

Bir request 10 microservice'den geciyor. Bir yerde bir sey bozuluyor. Log'lara bakiyorsun — binlerce satir. Trace'lere bakiyorsun — timing bilgisi var ama state yok. Metric'lere bakiyorsun — ne oldugunu goruyorsun ama NEDEN oldugunu goremiyorsun.

Sonuc: Muhendisler saatlerce, bazen gunlerce bug'i reproduce etmeye calisiyor. Cogu zaman edemiyorlar bile.

## Cozum

PARADOX, production ortamindaki her request'i deterministik olarak kaydeder ve gelistirici makinesinde birebir replay edebilir. Bir VCR gibi — ama distributed sistemler icin.

### Temel Yetenekler

- **Deterministic Record**: Tum I/O boundary'lerini (HTTP, DB, time, random) sifir-overhead ile kaydet
- **Time-Travel Replay**: Herhangi bir request'i yerelde birebir oynat, zamanda ileri/geri git
- **Distributed Tracing+**: Sadece trace degil, her servisin tam STATE'ini gor
- **Fix Verification**: Kodu degistir, ayni senaryoyu tekrar calistir — fix'in gercekten calisiyor mu?
- **Smart Sampling**: Akilli ornekleme ile production overhead'i %1'in altinda tut

## Mimari

```
Service A          Service B          Service C
   |                  |                  |
   | [Probe]          | [Probe]          | [Probe]
   |                  |                  |
   +--------+---------+--------+---------+
            |                  |
            v                  v
     +------+------------------+------+
     |       Event Collector (Rust)    |
     |    HLC Ordering + Compression   |
     +----------------+----------------+
                      |
          +-----------+-----------+
          |           |           |
          v           v           v
     +--------+  +--------+  +--------+
     |Storage |  |Replay  |  |Time    |
     |Engine  |  |Engine  |  |Travel  |
     |(CAS)   |  |(Det.)  |  |UI      |
     +--------+  +--------+  +--------+
```

## Packages

| Paket | Dil | Aciklama |
|-------|-----|----------|
| `paradox-probe` | TypeScript | Node.js icin kayit middleware'i |
| `paradox-collector` | Rust | Event toplama, siralama, sikistirma |
| `paradox-replay` | TypeScript/Rust | Deterministik replay motoru |
| `paradox-ui` | TypeScript (React) | Zaman yolculugu gorsel debugger |

## Hizli Baslangic

```bash
# Probe'u uygulamana ekle
npm install @paradox/probe

# Collector'u baslat
paradox-collector start

# UI'i ac
paradox-ui --port 3000
```

```typescript
import { ParadoxProbe } from '@paradox/probe';

const probe = new ParadoxProbe({
  serviceName: 'user-service',
  collectorUrl: 'http://localhost:4000',
});

app.use(probe.middleware());
```

## Lisans

Henuz belirlenmedi — commercial open-source (BSL/SSPL) dusunuluyor.
