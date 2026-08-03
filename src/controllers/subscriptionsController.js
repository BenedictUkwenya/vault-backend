const supabase = require('../config/supabase');
const stripeService = require('../services/stripeService');
const membership = require('../services/membershipService');

async function getPlans(_req, res) {
  res.json({
    member_plans: membership.MEMBER_PLANS,
    business_plan: membership.BUSINESS_PLAN,
  });
}

async function countVerifiedThisMonth(userId) {
  const { start, end } = membership.monthWindow();
  const { count } = await supabase
    .from('redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .not('verified_at', 'is', null)
    .gte('verified_at', start)
    .lt('verified_at', end);
  return count || 0;
}

async function getStatus(req, res) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('membership_tier, membership_expires_at, stripe_customer_id, student_verified_at')
    .eq('id', req.user.id)
    .single();

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.user.id)
    .in('status', ['active', 'trialing'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const tier = membership.effectiveTier(profile);
  const limit = membership.redemptionLimitForTier(tier);
  const used = await countVerifiedThisMonth(req.user.id);
  const remaining = limit == null ? null : Math.max(0, limit - used);

  res.json({
    is_active: membership.isMembershipActive(profile),
    tier,
    expires_at: profile?.membership_expires_at,
    student_verified_at: profile?.student_verified_at ?? null,
    subscription,
    redemptions: {
      used_this_month: used,
      limit,
      remaining,
    },
    plans: membership.MEMBER_PLANS,
  });
}

async function createCheckout(req, res) {
  const { price_id, success_url, cancel_url, type = 'member' } = req.body;
  const checkoutType = type === 'paid' ? 'member' : type;

  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id, email')
    .eq('id', req.user.id)
    .single();

  const customerId = await stripeService.getOrCreateCustomer(
    req.user.id,
    req.user.email,
    profile?.stripe_customer_id
  );

  const priceId = price_id || membership.priceIdForCheckoutType(checkoutType);
  if (!priceId) {
    return res.status(400).json({
      error: `Stripe price not configured for plan "${checkoutType}". Set the matching STRIPE_*_PRICE_ID env var.`,
    });
  }

  const session = await stripeService.createCheckoutSession({
    customerId,
    priceId,
    successUrl: success_url || `${process.env.FRONTEND_URL}/membership?success=true`,
    cancelUrl: cancel_url || `${process.env.FRONTEND_URL}/membership?canceled=true`,
    userId: req.user.id,
    subscriptionType: checkoutType,
  });

  res.json({ checkout_url: session.url, session_id: session.id });
}

async function createPortalSession(req, res) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('stripe_customer_id')
    .eq('id', req.user.id)
    .single();

  if (!profile?.stripe_customer_id) {
    return res.status(400).json({ error: 'No billing account found' });
  }

  const session = await stripeService.createPortalSession(
    profile.stripe_customer_id,
    req.body.return_url || `${process.env.FRONTEND_URL}/membership`
  );

  res.json({ portal_url: session.url });
}

async function cancel(req, res) {
  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', req.user.id)
    .in('status', ['active', 'trialing'])
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!subscription) return res.status(404).json({ error: 'No active subscription' });

  await stripeService.cancelSubscription(subscription.stripe_subscription_id);

  res.json({ message: 'Subscription will cancel at end of billing period' });
}

module.exports = { getPlans, getStatus, createCheckout, createPortalSession, cancel };
