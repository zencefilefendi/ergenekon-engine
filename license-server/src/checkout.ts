// ============================================================================
// ERGENEKON LICENSE SERVER — Stripe Checkout Session Creator
//
// Creates Stripe Checkout sessions for Pro and Enterprise plans.
// The customer is redirected to Stripe's hosted checkout page.
// ============================================================================

interface CheckoutRequest {
  plan: 'pro_monthly' | 'pro_annual' | 'enterprise';
  customerEmail?: string;
  successUrl?: string;
  cancelUrl?: string;
}

interface CheckoutResult {
  checkoutUrl: string;
  sessionId: string;
}

export async function handleCreateCheckout(data: CheckoutRequest): Promise<CheckoutResult> {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    throw new Error('STRIPE_SECRET_KEY not configured');
  }

  const Stripe = (await import('stripe')).default;
  const stripe = new Stripe(stripeKey);

  // Map plan to Stripe price ID
  const priceMap: Record<string, string | undefined> = {
    pro_monthly: process.env.STRIPE_PRO_MONTHLY_PRICE,
    pro_annual: process.env.STRIPE_PRO_ANNUAL_PRICE,
  };

  const priceId = priceMap[data.plan];
  const tier = data.plan.startsWith('pro') ? 'pro' : 'enterprise';

  // Enterprise → custom quote (no checkout)
  if (data.plan === 'enterprise') {
    return {
      checkoutUrl: 'mailto:enterprise@ergenekon.dev?subject=ERGENEKON%20Enterprise%20License',
      sessionId: 'enterprise_contact',
    };
  }

  if (!priceId) {
    throw new Error(`No Stripe price configured for plan: ${data.plan}`);
  }

  // SECURITY: Never trust client-supplied redirect URLs (open redirect risk).
  // Only allow redirects to our own domain.
  const ALLOWED_REDIRECT_HOST = 'ergenekon.dev';
  let successUrl = 'https://ergenekon.dev/success?session_id={CHECKOUT_SESSION_ID}';
  let cancelUrl = 'https://ergenekon.dev/pricing';
  try {
    if (data.successUrl && new URL(data.successUrl).hostname === ALLOWED_REDIRECT_HOST) {
      successUrl = data.successUrl;
    }
    if (data.cancelUrl && new URL(data.cancelUrl).hostname === ALLOWED_REDIRECT_HOST) {
      cancelUrl = data.cancelUrl;
    }
  } catch { /* invalid URL → use safe defaults */ }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: data.customerEmail,
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { tier },
    subscription_data: {
      metadata: { tier },
    },
  });

  return {
    checkoutUrl: session.url!,
    sessionId: session.id,
  };
}
