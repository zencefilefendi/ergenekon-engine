PARADOX Engine — Ürünleştirme Master Planı
Hedef: PARADOX Engine'i açık kaynak projeden satılabilir, lisanslı, güvenli, profesyonel bir ürüne dönüştürmek.

Mevcut Durum Özeti
Bileşen	Durum	Not
Core Engine (6 paket)	✅ Tamamlandı	v0.4.0, npm pack verified
Testler	✅ 173/173 geçiyor	13 dosya, 1.57s
Landing Page	✅ Mevcut	Statik HTML, premium dark theme
Dashboard (UI)	✅ Mevcut	Fonksiyonel ama temel
CI/CD	✅ GitHub Actions	Build + test + publish workflows
Docker/Helm	✅ Mevcut	Compose + Kubernetes chart
Lisans Sistemi	❌ YOK	Satış mekanizması yok
Ödeme Entegrasyonu	❌ YOK	Stripe/payment yok
Feature Gating	❌ YOK	Tüm özellikler açık
Güvenlik	⚠️ Temel	Obfuscation/license check yok
Proposed Changes
Faz 1: Kriptografik Lisans Sistemi 🔐
İlk ve en kritik adım. Ürünü satabilmek için lisans doğrulama mekanizması gerekli.

Tasarım: Ed25519 Digital Signature License Keys
Lisans akışı:
  1. Müşteri ödeme yapar (Stripe)
  2. Webhook → License Generator çalışır
  3. Ed25519 private key ile lisans imzalanır
  4. JSON license token üretilir
  5. Müşteriye email ile gönderilir
  6. Müşteri `.paradox-license.json` dosyasını projesine koyar
  7. Probe başlatılırken lisans doğrulanır (public key ile)
  8. Tier'a göre özellikler açılır
Lisans Token Formatı:

json
{
  "version": 1,
  "licenseId": "lic_01HWXYZ...",
  "customerId": "cus_abc123",
  "customerEmail": "user@company.com",
  "customerName": "ACME Corp",
  "tier": "pro",
  "maxServices": -1,
  "maxEventsPerDay": 1000000,
  "features": ["distributed_replay", "smart_sampling", "deep_redaction", "prdx_export", "time_travel_ui"],
  "issuedAt": "2026-04-14T00:00:00Z",
  "expiresAt": "2027-04-14T00:00:00Z",
  "signature": "base64_ed25519_signature..."
}
[NEW] 
license-types.ts
LicenseToken interface
LicenseTier type: 'community' | 'pro' | 'enterprise'
TIER_FEATURES map — her tier'ın hangi özelliklere sahip olduğu
TIER_LIMITS — servis/event/retention limitleri
[NEW] 
license-validator.ts
Ed25519 public key embedded (sadece public key — private key ASLA repoda olmaz)
validateLicense(token: string): LicenseValidation — imza doğrulama
hasFeature(license, feature): boolean — özellik kontrolü
isExpired(license): boolean — süre kontrolü
getLimits(license): TierLimits — limit okuma
Offline çalışır — internet bağlantısı GEREKMEZ
[NEW] 
license-generator.ts
SADECE server-side — npm'e publish edilMEZ
Ed25519 private key ile lisans imzalama
generateLicense(params): LicenseToken
.npmignore ile dışlanacak
[MODIFY] 
index.ts
License types ve validator'ı export et
Faz 2: Feature Gating (Özellik Kilitleme) 🚪
Tier'a göre özellikleri aç/kapat. Community ücretsiz, Pro/Enterprise lisanslı.

Tier Bazlı Özellik Matrisi
Özellik	Community (Ücretsiz)	Pro ($49/ay)	Enterprise ($199/ay)
Tek servis record/replay	✅	✅	✅
CLI (temel komutlar)	✅	✅	✅
24 saat retention	✅	✅	✅
Multi-service distributed replay	❌	✅	✅
Smart sampling engine	❌	✅	✅
Deep field redaction	❌	✅	✅
Binary PRDX export	❌	✅	✅
Time-Travel UI	❌	✅	✅
30 gün retention	❌	✅	✅
Sınırsız retention	❌	❌	✅
SSO / SAML	❌	❌	✅
RBAC	❌	❌	✅
On-premise	❌	❌	✅
SLA %99.9	❌	❌	✅
fs/dns interceptors	❌	✅	✅
[MODIFY] 
index.ts
Probe constructor'da lisans dosyası arama (~/.paradox-license.json, ./paradox-license.json, env var)
Lisans doğrulama → tier belirleme
start() içinde tier'a göre interceptor kısıtlama
Community: globals + http-incoming + http-outgoing ONLY
Pro: + sampling + redaction + fs + dns + database
Enterprise: + tüm gelecek özellikler
Lisans yoksa → Community mode (graceful degradation, uyarı mesajı)
[MODIFY] 
server.ts
Retention policy enforcement based on license tier
Session sayısı limitlenmesi
Community: max 100 session, 24h retention
Pro: unlimited session, 30 day retention
[MODIFY] 
server.ts
License check middleware — UI only available on Pro+
Community → upgrade prompt
Faz 3: Dashboard Yükseltmesi 🎨
Dashboard'u "temel debugger"dan "premium profesyonel araç"a yükselt.

Anahtar İyileştirmeler
Premium Header Redesign

Glassmorphism navbar
Animated PARADOX logo
License tier badge (Community/Pro/Enterprise)
Real-time connection pulse animation
Enhanced Session Panel

Session gruplandırma (trace ID bazlı)
Mini sparkline graph (her session için event timeline)
Error rate indicator (kırmızı/yeşil/sarı dot)
Duration histogram mini-chart
Favoriler & pin sistemi
Advanced Timeline

Çok renkli event markers (tip bazlı gradient)
Zoom in/out capability
Minimap (tüm session overview)
Event clustering (yoğun bölgeler)
Breakpoint markers
Split-View Comparison

İki session'ı yan yana karşılaştır
Diff highlighting (farklılıkları vurgula)
Regression detection
Real-Time Metrics Panel

Events/second counter
Active services list
Error rate gauge
Sampling stats
Storage usage
Visual Enhancements

Micro-animations (panel transitions, hover effects)
Keyboard shortcut overlay (? tuşu)
Dark/light theme toggle
Custom scrollbar styling
Loading skeletons
Dosya Değişiklikleri
[MODIFY] 
index.html
Yeniden yapılandırılmış layout
Metrics panel eklenmesi
Comparison view
Upgrade prompt (Community tier)
[MODIFY] 
styles.css
Glassmorphism design system
Micro-animation keyframes
Premium color palette
Responsive improvements
[MODIFY] 
app.js
Metrics polling
Session comparison logic
Dark/light theme toggle
Keyboard shortcut help overlay
License tier display
Sparkline rendering
Faz 4: Landing Page Yükseltmesi 🌐
Satış yapacak seviyede, interaktif, demo gösteren bir web sitesi.

[MODIFY] 
index.html
Eklenecek bölümler:

Interactive Terminal Demo — Sayfada gerçek zamanlı bir terminal simülasyonu

Otomatik yazım animasyonu
npm install @paradox/probe → kurulum animasyonu
Record → Replay → "BYTE-FOR-BYTE IDENTICAL ✅" sonuç
Animated Architecture Diagram

SVG animasyonlu mimari akış diyagramı
Probe → Collector → Storage → Replay → UI akışı
Hover'da detay açılması
Social Proof Section

GitHub stars counter (API ile gerçek zamanlı)
npm download badge
"Built by" section
FAQ Accordion

Güvenlik, performans, kurulum, lisanslama soruları
Pricing Section Enhancement

"Buy Now" butonları → Stripe Checkout'a yönlendirme
Annual vs Monthly toggle
Enterprise "Book a Demo" formu
Newsletter Signup

Email toplama formu
Early access / beta erişimi
Faz 5: Ödeme Sistemi (Stripe Integration) 💳
Müşteri ödeme yapar → Otomatik lisans anahtarı üretilir → Email ile gönderilir

Mimari
Landing Page "Buy Now" butonu
    │
    ▼
Stripe Checkout (hosted page)
    │
    ▼
Stripe Webhook → License API
    │
    ├── 1. Ödeme doğrulanır
    ├── 2. License Generator çalışır (Ed25519 imza)
    ├── 3. Lisans token dosya üretilir
    ├── 4. Email ile müşteriye gönderilir
    └── 5. Dashboard'da aktivasyon rehberi
[NEW] license-server/ (Yeni dizin — repo kökünde)
Bağımsız, minimal Node.js server — Stripe webhook + license generation

license-server/src/index.ts — HTTP server + routes
license-server/src/stripe-webhook.ts — Webhook handler
license-server/src/license-gen.ts — Ed25519 signing
license-server/src/email.ts — SendGrid/Resend ile email
license-server/Dockerfile — Deploy hazır container
license-server/package.json
IMPORTANT

Private key SADECE license-server'da olacak. Asla npm paketinde veya repo'da olmayacak.

Stripe Ürün Yapısı
Stripe Product	Fiyat	License Tier
PARADOX Pro Monthly	$49/dev/ay	pro
PARADOX Pro Annual	$39/dev/ay ($468/yıl)	pro
PARADOX Enterprise	Custom quote	enterprise
Faz 6: Güvenlik Sertleştirmesi 🛡️
Kod Koruma
License Validator Integrity — Validator kodunun değiştirilmediğini kontrol

Self-hash check (validator kendi hash'ini doğrular)
Tamper detection logging
Rate Limiting — Collector API'ye rate limit

Community: 100 req/min
Pro: 10,000 req/min
Enterprise: unlimited
Audit Logging — Tüm lisans doğrulama girişimlerinin logu

Geçersiz lisans denemeleri
Feature erişim denemeleri
Telemetry (Optional, Opt-in)

Anonim kullanım istatistikleri
Crash reporting
Feature usage tracking
WARNING

Private key güvenliği kritik. Ed25519 private key:

Sadece license-server'da
Environment variable olarak (PARADOX_SIGNING_KEY)
Asla git'e commit edilmez
.env.example dosyasında placeholder
Faz 7: End-to-End Test ve Doğrulama ✅
Test Planı
Mevcut Testler — 173 testin geçtiğini doğrula ✅ (zaten yapıldı)

Lisans Testleri (YENİ)

License key üretimi + doğrulama roundtrip
Expired license rejection
Invalid signature rejection
Tampered license detection
Tier-based feature check
Graceful degradation (no license → Community)
Feature Gating Testleri (YENİ)

Community → Pro özelliklerine erişemez
Pro → Enterprise özelliklerine erişemez
License upgrade → yeni özellikler açılır
Integration Test

npx tsx demo/replay-demo.ts → byte-for-byte replay
Dashboard başlatma + session listesi
Collector health check
Browser Test

Landing page doğru render ediliyor mu?
Stripe Checkout butonu çalışıyor mu?
Dashboard UI tamamen yükleniyor mu?
Faz 8: Launch Hazırlığı 🚀
npm Publish

npm run publish:all ile tüm 6 paketi yayınla
Scoped packages: @paradox/core, @paradox/probe, vs.
GitHub Release

v0.5.0 tag → changelog + binary artifacts
Release notes (EN + TR)
Landing Page Deploy

GitHub Pages veya Vercel/Netlify
Custom domain: paradoxengine.dev
README Güncelleme

Kurulum + hızlı başlangıç
Lisanslama açıklaması
Badge'ler (npm version, tests, coverage)
Product Hunt Hazırlık

Tagline: "The Black Box for Software — Record & replay production bugs, byte-for-byte identical"
Thumbnail + screenshots
Maker comment
Uygulama Sırası
Adım	Faz	Tahmini Süre	Bağımlılık
1	🔐 Lisans Sistemi	~30 dk	Yok
2	🚪 Feature Gating	~20 dk	Faz 1
3	🎨 Dashboard Upgrade	~45 dk	Faz 2
4	🌐 Landing Page	~30 dk	Faz 2
5	💳 Stripe Integration	~30 dk	Faz 1
6	🛡️ Güvenlik	~15 dk	Faz 1, 2
7	✅ E2E Test	~15 dk	Tümü
8	🚀 Launch	~15 dk	Tümü
Open Questions
IMPORTANT

Stripe Account: Stripe hesabın var mı? Yoksa test modda mı ilerleyelim?

IMPORTANT

Domain: paradoxengine.dev domain'i satın alındı mı? Landing page nereye deploy edilecek (Vercel, Netlify, GitHub Pages)?

IMPORTANT

npm Organization: @paradox npm scope'u alındı mı? Yoksa farklı scope mu kullanalım (@paradox-engine)?

IMPORTANT

Email Servisi: Lisans key email ile gönderimi için SendGrid, Resend, veya başka bir servis tercihin var mı?

Verification Plan
Automated Tests
bash
# 1. Mevcut testler
npm test
# 2. Lisans testleri
npx vitest run packages/paradox-core/src/license-validator.test.ts
# 3. Feature gating testleri  
npx vitest run packages/paradox-probe/src/license-gate.test.ts
# 4. Integration test
npx tsx demo/replay-demo.ts
# 5. Build verification
npm run build
Manual Verification
Landing page'i tarayıcıda aç → Stripe Checkout butonları çalışıyor mu?
Dashboard'u başlat → Pro features kilitli mi? (Community mode)
Geçerli lisans ile başlat → Pro features açık mı?
Demo app çalıştır → recording + replay başarılı mı?
Browser Testing
Landing page render doğrulaması
Dashboard UI fonksiyonellik testi
Stripe Checkout flow (test mode)
