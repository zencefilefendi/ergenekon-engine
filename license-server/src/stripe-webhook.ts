// ============================================================================
// ERGENEKON LICENSE SERVER — Stripe Webhook Handler
//
// Processes Stripe webhook events:
//   - checkout.session.completed → Generate license key
//   - customer.subscription.deleted → Log cancellation
//
// The webhook secret is used to verify Stripe signatures.
// ============================================================================

import { generateLicenseForCustomer, formatLicenseJSON } from './license-gen.js';
import { sendLicenseEmail } from './email.js';

// ── Types ───────────────────────────────────────────────────────

interface StripeEvent {
  id: string;
  type: string;
  data: {
    object: Record<string, unknown>;
  };
}

interface WebhookResult {
  received: boolean;
  action?: string;
  licenseId?: string;
  error?: string;
}

// ── Webhook Handler ─────────────────────────────────────────────

export async function handleStripeWebhook(
  body: Buffer,
  signature: string,
): Promise<WebhookResult> {
  // Verify webhook signature
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    // SECURITY: Fail-closed — if webhook secret is not configured, reject ALL webhooks.
    // Never process unverified webhook events in any environment.
    console.error('[SECURITY] /api/webhook called but STRIPE_WEBHOOK_SECRET is not configured. Rejecting.');
    return { received: false, error: 'Webhook endpoint not configured' };
  }

  // Verify the Stripe signature
  try {
    const Stripe = (await import('stripe')).default;
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
    const event = stripe.webhooks.constructEvent(
      body.toString('utf-8'),
      signature,
      webhookSecret,
    ) as unknown as StripeEvent;

    return processEvent(event);
  } catch (err) {
    console.error('[WEBHOOK] Signature verification failed:', err);
    return { received: false, error: 'Invalid signature' };
  }
}

// ── Event Processing ────────────────────────────────────────────

// SECURITY: Idempotency — prevent duplicate license generation on Stripe retries
const processedEventIds = new Set<string>();
const MAX_IDEMPOTENCY_SET = 10_000;

async function processEvent(event: StripeEvent): Promise<WebhookResult> {
  console.log(`[WEBHOOK] Received event: ${event.type} (${event.id})`);

  // Idempotency check: skip already-processed events
  if (processedEventIds.has(event.id)) {
    console.log(`[WEBHOOK] Duplicate event ${event.id} — skipping`);
    return { received: true, action: 'duplicate_skipped' };
  }
  // Prevent unbounded Set growth
  if (processedEventIds.size >= MAX_IDEMPOTENCY_SET) {
    const first = processedEventIds.values().next().value;
    if (first) processedEventIds.delete(first);
  }
  processedEventIds.add(event.id);

  switch (event.type) {
    case 'checkout.session.completed':
      return handleCheckoutCompleted(event.data.object);

    case 'customer.subscription.deleted':
      return handleSubscriptionCancelled(event.data.object);

    default:
      return { received: true, action: 'ignored' };
  }
}

// ── Checkout Completed → Generate License ───────────────────────

async function handleCheckoutCompleted(
  session: Record<string, unknown>,
): Promise<WebhookResult> {
  const customerEmail = (session.customer_email as string) || (session.customer_details as any)?.email || 'unknown@example.com';
  const customerId = (session.customer as string) || `cus_${Date.now()}`;
  const customerName = (session.customer_details as any)?.name || customerEmail.split('@')[0];

  // Determine tier from metadata — SECURITY: reject unknown tiers
  const metadata = session.metadata as Record<string, string> | undefined;
  const rawTier = metadata?.tier;
  if (rawTier && !['pro', 'enterprise'].includes(rawTier)) {
    console.error(`[SECURITY] Unknown tier in checkout metadata: ${rawTier}`);
    return { received: false, error: `Invalid tier: ${rawTier}` };
  }
  const tier = (rawTier as 'pro' | 'enterprise') || 'pro';

  console.log(`[WEBHOOK] Generating ${tier} license for ${customerEmail}`);

  try {
    const license = generateLicenseForCustomer({
      customerId,
      customerEmail,
      customerName,
      tier,
      durationDays: 365,
    });

    const licenseJSON = formatLicenseJSON(license);

    console.log(`[WEBHOOK] ✅ License generated: ${license.payload.licenseId}`);
    console.log(`[WEBHOOK] Customer: ${customerEmail} (${tier})`);
    console.log(`[WEBHOOK] Expires: ${license.payload.expiresAt}`);

    // Send license via email (Resend)
    const emailSent = await sendLicenseEmail({
      to: customerEmail,
      customerName,
      tier,
      licenseId: license.payload.licenseId,
      licenseJSON,
    });

    if (!emailSent) {
      console.log(`[WEBHOOK] Email not sent — license JSON:\n${licenseJSON}`);
    }

    return {
      received: true,
      action: 'license_generated',
      licenseId: license.payload.licenseId,
    };
  } catch (err) {
    console.error('[WEBHOOK] License generation failed:', err);
    // SECURITY: Return received:false so Stripe retries on transient failures
    // (H5: returning 200 on failure prevented Stripe's retry logic)
    return { received: false, error: 'License generation failed — will retry' };
  }
}

// ── Subscription Cancelled ──────────────────────────────────────

async function handleSubscriptionCancelled(
  subscription: Record<string, unknown>,
): Promise<WebhookResult> {
  const customerId = subscription.customer as string;
  console.log(`[WEBHOOK] Subscription cancelled for customer: ${customerId}`);

  // TODO: Mark license as expired in database
  // await expireLicense(customerId);

  return { received: true, action: 'subscription_cancelled' };
}
