# ERGENEKON — Stripe Configuration Guide

## Prerequisites
- A [Stripe account](https://dashboard.stripe.com/register) (free to create)
- A [Resend account](https://resend.com) (free tier: 100 emails/day)
- Node.js 18+

---

## Step 1: Create Stripe Products

Go to [Stripe Dashboard → Products](https://dashboard.stripe.com/products) and create:

### Product 1: ERGENEKON Pro
```
Name: ERGENEKON Pro
Description: Deterministic session recording for Node.js — Pro tier
```

Add 2 prices:
| Price Name | Amount | Billing | Lookup Key |
|------------|--------|---------|------------|
| Pro Monthly | $49.00/month | Recurring | `pro_monthly` |
| Pro Annual | $468.00/year | Recurring | `pro_annual` |

### Product 2: ERGENEKON Enterprise
```
Name: ERGENEKON Enterprise
Description: Enterprise-grade session recording with SSO, RBAC, unlimited retention
```

Add 1 price:
| Price Name | Amount | Billing | Lookup Key |
|------------|--------|---------|------------|
| Enterprise Monthly | $199.00/month | Recurring | `enterprise_monthly` |

**Copy the Price IDs** (e.g., `price_1abc...`) — you'll need them for environment variables.

---

## Step 2: Create Webhook Endpoint

Go to [Stripe Dashboard → Developers → Webhooks](https://dashboard.stripe.com/webhooks)

### Add Endpoint
```
URL: https://license.ergenekon.dev/api/webhook
Description: ERGENEKON License Server
```

### Select Events
Check these events:
- ✅ `checkout.session.completed`
- ✅ `customer.subscription.deleted`
- ✅ `customer.subscription.updated`
- ✅ `invoice.payment_failed`

### Copy the Webhook Signing Secret
After creating the endpoint, click "Reveal signing secret" and copy the `whsec_...` value.

---

## Step 3: Generate Ed25519 Key Pair

This was already done during setup. The keys are in:
- **Private key**: `license-server/keys/private.pem` (⚠️ NEVER commit this)
- **Public key**: `license-server/keys/public.pem` (embedded in `@ergenekon/core`)

To convert the private key for environment variables:
```bash
# Convert PEM to single-line for .env
cat license-server/keys/private.pem | tr '\n' '~' | sed 's/~/\\n/g'
```

---

## Step 4: Configure Environment Variables

Create `license-server/.env` from the template:
```bash
cp license-server/.env.example license-server/.env
```

Fill in all values:
```env
# Stripe (from Steps 1-2)
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRO_MONTHLY_PRICE=price_...
STRIPE_PRO_ANNUAL_PRICE=price_...

# Ed25519 (from Step 3)
ERGENEKON_SIGNING_KEY="-----BEGIN PRIVATE KEY-----\nMC4CA..."

# Resend (from resend.com → API Keys)
RESEND_API_KEY=re_...

# Admin
ADMIN_API_KEY=your-secure-random-key-here

# Server
LICENSE_SERVER_PORT=4400
```

---

## Step 5: Configure Resend

1. Go to [resend.com](https://resend.com) → Sign up
2. **Verify your domain**: Add DNS records for `ergenekon.dev`
   - Add TXT record for SPF
   - Add CNAME for DKIM
3. Go to **API Keys** → Create a new key → Copy `re_...`
4. Set `RESEND_API_KEY` in your `.env`

> **Note**: During development, Resend allows sending to your own email without domain verification.

---

## Step 6: Test Locally

```bash
# Start the license server
cd license-server
npx tsx src/index.ts

# Test health
curl http://localhost:4400/health

# Test manual license generation (development)
curl -X POST http://localhost:4400/api/generate-license \
  -H "Content-Type: application/json" \
  -H "X-Admin-Key: your-admin-key" \
  -d '{
    "customerId": "test_123",
    "customerEmail": "your@email.com",
    "customerName": "Test User",
    "tier": "pro"
  }'
```

### Test Stripe Webhooks Locally
```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to http://localhost:4400/api/webhook

# Trigger a test event
stripe trigger checkout.session.completed
```

---

## Step 7: Deploy

### Option A: Railway
```bash
# Install Railway CLI
npm install -g @railway/cli

# Login & deploy
railway login
railway init
railway up
```

Set environment variables in Railway dashboard.

### Option B: Fly.io
```bash
# Install Fly CLI
brew install flyctl

# Deploy
fly launch
fly secrets set STRIPE_SECRET_KEY=sk_live_...
fly secrets set STRIPE_WEBHOOK_SECRET=whsec_...
fly secrets set ERGENEKON_SIGNING_KEY="..."
fly secrets set RESEND_API_KEY=re_...
fly secrets set ADMIN_API_KEY=...
fly deploy
```

### Option C: Docker
```bash
docker build -f docker/license-server.Dockerfile -t ergenekon-license-server .
docker run -p 4400:4400 --env-file license-server/.env ergenekon-license-server
```

---

## Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `STRIPE_SECRET_KEY` | ✅ | Stripe API secret key |
| `STRIPE_WEBHOOK_SECRET` | ✅ | Stripe webhook signing secret |
| `STRIPE_PRO_MONTHLY_PRICE` | ✅ | Stripe price ID for Pro monthly |
| `STRIPE_PRO_ANNUAL_PRICE` | ⬜ | Stripe price ID for Pro annual |
| `ERGENEKON_SIGNING_KEY` | ✅ | Ed25519 private key (PEM) |
| `RESEND_API_KEY` | ✅ | Resend API key for email delivery |
| `ADMIN_API_KEY` | ✅ | Admin API key for manual license gen |
| `LICENSE_SERVER_PORT` | ⬜ | Server port (default: 4400) |
