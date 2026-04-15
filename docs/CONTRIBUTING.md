# ERGENEKON Engine — Katkı Rehberi

ERGENEKON Engine'e katkıda bulunmak istiyorsanız doğru yerdesiniz. Bu belge geliştirme ortamı kurulumunu, kod standartlarını ve katkı sürecini açıklar.

---

## Geliştirme Ortamı Kurulumu

### Gereksinimler

- **Node.js** >= 20.0.0
- **npm** >= 10.0.0
- **TypeScript** (devDependency olarak gelir)
- **Git**

### Kurulum

```bash
# 1. Fork et ve klonla
git clone https://github.com/YOUR_USERNAME/ergenekon-engine
cd ergenekon-engine

# 2. Bağımlılıkları yükle (tüm workspace'ler)
npm install

# 3. Build et (TypeScript → JavaScript)
npm run build

# 4. Demo'yu çalıştır (sağlıklı mı kontrol et)
npm run demo:fullstack
```

### Proje Yapısı

```
ergenekon-engine/
├── packages/
│   ├── ergenekon-core/        → Temel tipler, HLC, ULID, session I/O
│   ├── ergenekon-probe/       → Express middleware, interceptors
│   ├── ergenekon-collector/   → HTTP server, storage
│   ├── ergenekon-replay/      → Replay engine, mock layer
│   ├── ergenekon-ui/          → Web UI
│   └── ergenekon-cli/         → CLI araçları
├── demo/
│   ├── fullstack-demo.ts    → Tüm servisleri başlatır
│   └── replay-demo.ts       → Record → replay → verify
├── docs/                    → Tüm dokümantasyon
├── tsconfig.base.json       → Paylaşılan TypeScript config
└── package.json             → Monorepo root
```

---

## Geliştirme Döngüsü

### Kod Değiştirme

```bash
# Belirli bir paketi watch modunda derle
cd packages/ergenekon-probe
npx tsc --watch

# Ya da tsx ile direkt çalıştır (build gerekmez)
npx tsx demo/fullstack-demo.ts
```

### Build

```bash
# Tüm paketleri derle
npm run build

# Tek paket
npm run build --workspace=packages/ergenekon-core
```

### Test

```bash
# Quick sanity check
npx tsx demo/replay-demo.ts

# Full integration test
npm run demo:fullstack &
sleep 3
curl -X POST http://localhost:3001/api/orders \
  -H "Content-Type: application/json" \
  -d '{"userId":"2"}'
npx tsx packages/ergenekon-cli/src/index.ts sessions
```

---

## Kod Standartları

### TypeScript

- **Strict mode** zorunlu (`"strict": true` tsconfig'de)
- `any` kullanmaktan kaçın — zorunluysa `// eslint-disable-next-line` ekle
- Her public fonksiyon için JSDoc comment
- Import sırası: Node built-ins → external → internal → relative

### Kritik Kurallar

```typescript
// ✅ DOĞRU: originalDateNow kullan
import { originalDateNow } from '../internal-clock.js';
const now = originalDateNow();

// ❌ YANLIŞ: Asla direkt Date.now() çağırma (recording logic içinde)
const now = Date.now(); // Bu patch'lenmiş olabilir!

// ✅ DOĞRU: Re-entrancy guard
let _recording = false;
Date.now = () => {
  if (_recording) return _originalDateNow();
  _recording = true;
  try { /* kayıt */ }
  finally { _recording = false; }
};

// ✅ DOĞRU: Her interceptor uninstall'ı desteklemeli
export function uninstallXxxInterceptor(): void {
  // Orijinali geri yükle
}
```

### Dosya İsimlendirme

- Dosyalar: `kebab-case.ts`
- Sınıflar: `PascalCase`
- Fonksiyonlar: `camelCase`
- Sabitler: `UPPER_SNAKE_CASE`

### Commit Mesajları

[Conventional Commits](https://www.conventionalcommits.org/) formatı:

```
feat: yeni özellik açıklaması
fix: hata düzeltme açıklaması
docs: dokümantasyon güncellemesi
refactor: kod yeniden düzenleme
test: test ekleme/güncelleme
chore: build, bağımlılık güncellemesi

Örnekler:
feat(probe): add adaptive sampling with error rate threshold
fix(collector): handle concurrent session writes safely
docs(architecture): add HLC algorithm explanation
```

---

## Paket Geliştirme Rehberi

### Yeni Interceptor Ekleme

1. `packages/ergenekon-probe/src/interceptors/` altında yeni dosya oluştur
2. Şu imzaları uygula:

```typescript
let installed = false;

export function installXxxInterceptor(): boolean {
  if (installed) return true;
  try {
    // Orijinali sakla
    // Patch'i yükle
    installed = true;
    console.log('[ERGENEKON] Xxx interceptor installed');
    return true;
  } catch {
    return false; // bağımlılık yüklü değil
  }
}

export function uninstallXxxInterceptor(): void {
  if (!installed) return;
  // Orijinali geri yükle
  installed = false;
}
```

3. `packages/ergenekon-probe/src/index.ts`'e ekle
4. `packages/ergenekon-core/src/types.ts`'deki `EventType`'a yeni event ekle (gerekirse)

### Yeni CLI Komutu Ekleme

`packages/ergenekon-cli/src/index.ts` içindeki `main()` switch'e ekle:

```typescript
case 'mycommand':
  await cmdMyCommand(args[1]);
  break;
```

### Yeni API Endpoint Ekleme (Collector)

`packages/ergenekon-collector/src/server.ts` içindeki `handleRequest()` fonksiyonuna ekle:

```typescript
if (req.method === 'GET' && path === '/api/v1/myendpoint') {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ /* data */ }));
  return;
}
```

---

## Pull Request Süreci

1. **Branch oluştur**: `feat/my-feature` veya `fix/bug-description`
2. **Kodunu yaz** + testleri çalıştır
3. **Build kontrol**: `npm run build` hatasız çalışmalı
4. **Demo kontrol**: `npm run demo:fullstack` çalışmalı
5. **PR aç**: Açıklama şablonunu doldur

### PR Açıklama Şablonu

```markdown
## Ne değişti?
[Kısa açıklama]

## Neden?
[Motivasyon / Problem]

## Nasıl test ettim?
- [ ] `npm run build` hatasız
- [ ] `npm run demo:fullstack` çalışıyor
- [ ] CLI komutları doğru çıktı veriyor
- [ ] Yeni interceptor uninstall edilebiliyor

## Breaking changes var mı?
[Evet/Hayır + açıklama]
```

---

## Kritik Değişmezler (Asla İhlal Etme)

```
1. Recording logic içinde Date.now() veya Math.random() ÇAĞIRMA
   → originalDateNow() ve originalMathRandom() kullan

2. Her interceptor MUTLAKA uninstall edilebilmeli
   → uninstall* fonksiyonu zorunlu

3. Recording olmayan request'lerde SIFIR overhead
   → Her interceptor: "session yoksa return" olmalı

4. Replay doğruluğu performanstan önce gelir
   → Determinizmi asla feda etme

5. _recording flag her record() çağrısını sarmalı
   → Sonsuz döngüyü önler

6. Orijinaller asla mutate edilmemeli
   → redactDeep() her zaman yeni obje döner
```

---

## Sorun Bildirimi

GitHub Issues'da şu bilgileri ekle:

```
Node.js version: v22.x.x
ERGENEKON version: 0.4.x
OS: macOS/Linux/Windows

Beklenen davranış:
Gerçekleşen davranış:
Tekrarlama adımları:
```

---

## Yardım

- GitHub Discussions: Soru sor, fikir paylaş
- Issues: Bug raporu, feature request
