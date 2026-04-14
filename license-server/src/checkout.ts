// ============================================================================
// PARADOX LICENSE SERVER — Stripe Checkout Session Creator
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
      checkoutUrl: 'mailto:enterprise@paradoxengine.dev?subject=PARADOX%20Enterprise%20License',
      sessionId: 'enterprise_contact',
    };
  }

  if (!priceId) {
    throw new Error(`No Stripe price configured for plan: ${data.plan}`);
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    customer_email: data.customerEmail,
    success_url: data.successUrl || 'https://paradoxengine.dev/success?session_id={CHECKOUT_SESSION_ID}',
    cancel_url: data.cancelUrl || 'https://paradoxengine.dev/pricing',
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
