# ERGENEKON Engine — npm Publish Kılavuzu

Bu belge ERGENEKON paketlerini npm'e nasıl yayınlayacağını açıklar.

---

## Ön Hazırlık

### 1. npm Hesabı ve Organizasyon

```bash
# npm hesabı oluştur: https://www.npmjs.com/signup
# @ergenekon organizasyonu oluştur: https://www.npmjs.com/org/create

# Login
npm login
# → Username, password, email, OTP sorar

# Verify
npm whoami   # → zencefilefendi (veya hesap adın)
```

### 2. `@ergenekon` Scope İzni

`@ergenekon` npm scope'u için organizasyon sahibi olman gerekiyor.
Eğer `@ergenekon` zaten alınmışsa, `@ergenekon-engine` veya kendi kullanıcı adınla scope kullanabilirsin:

```bash
# Kendi scope (hemen çalışır):
@zencefilefendi/ergenekon-core
@zencefilefendi/ergenekon-probe
# vb.
```

Her `package.json`'daki `name` alanını güncellemen yeterli.

---

## Publish Adımları

### Otomatik (CI/CD — Önerilen)

1. `NPM_TOKEN` secret oluştur:
   ```
   npm token create --type automation
   ```
2. GitHub'a ekle: **Settings → Secrets → Actions → NPM_TOKEN**
3. Tag push et:
   ```bash
   git tag v0.5.0
   git push origin v0.5.0
   ```
4. `.github/workflows/publish.yml` otomatik çalışır → tüm paketler publish edilir.

### Manuel

```bash
# 1. Build
npm run build

# 2. Test
npx tsx demo/replay-demo.ts

# 3. Publish hepsini
npm run publish:all
```

---

## Versiyon Yönetimi

Tüm paketler birlikte versiyonlanır (monorepo koordinasyonu):

```bash
# Tüm paketleri aynı anda patch bump yap
npm version patch --workspaces

# Minor bump
npm version minor --workspaces

# Belirli bir versiyon
npm version 0.5.0 --workspaces

# Tag oluştur ve push et
git tag v0.5.0
git push origin main --tags
```

---

## Publish Sonrası Kontrol

```bash
# npm'de görünüyor mu?
npm info @ergenekon/probe

# Install edebiliyoruz mı?
cd /tmp && mkdir test-install && cd test-install
npm init -y
npm install @ergenekon/probe @ergenekon/collector @ergenekon/replay

# CLI çalışıyor mu?
npm install -g @ergenekon/cli
ergenekon help
```

---

## Paket Bağımlılık Sırası

npm `npm publish` sırası önemlidir — bağımlılıklar önce publish edilmeli:

```
1. @ergenekon/core       ← bağımlılık yok
2. @ergenekon/probe      ← @ergenekon/core
3. @ergenekon/collector  ← @ergenekon/core
4. @ergenekon/replay     ← @ergenekon/core
5. @ergenekon/cli        ← @ergenekon/core, @ergenekon/replay
6. @ergenekon/ui         ← @ergenekon/core
```

`publish.yml` CI workflow bu sırayı doğru şekilde uygular.

---

## Unpublish / Deprecate

```bash
# 72 saat içinde unpublish
npm unpublish @ergenekon/probe@0.4.0

# Deprecate (silinmez, uyarı gösterilir)
npm deprecate @ergenekon/probe@0.4.0 "Use 0.5.0 instead"
```
