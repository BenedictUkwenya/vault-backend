const supabase = require('../config/supabase');
const stripeService = require('../services/stripeService');

async function getStatus(req, res) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('membership_tier, membership_expires_at, stripe_customer_id')
    .eq('id', req.user.id)
    .single();

  const { data: subscription } = await supabase
    .from('subscriptions')
    .select('*')
    .eq('user_id', req.user.id)
    .eq('status', 'active')
    .single();

  const isActive =
    profile?.membership_tier === 'paid' &&
    (!profile?.membership_expires_at || new Date(profile.membership_expires_at) > new Date());

  res.json({
    is_active: isActive,
    tier: profile?.membership_tier || 'free',
    expires_at: profile?.membership_expires_at,
    subscription,
  });
}

async function createCheckout(req, res) {
  const { price_id, success_url, cancel_url, type = 'member' } = req.body;

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

  const session = await stripeService.createCheckoutSession({
    customerId,
    priceId: price_id || (type === 'business' ? process.env.STRIPE_BUSINESS_PRICE_ID : process.env.STRIPE_MEMBER_PRICE_ID),
    successUrl: success_url || `${process.env.FRONTEND_URL}/membership?success=true`,
    cancelUrl: cancel_url || `${process.env.FRONTEND_URL}/membership?canceled=true`,
    userId: req.user.id,
    subscriptionType: type,
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
    .eq('status', 'active')
    .single();

  if (!subscription) return res.status(404).json({ error: 'No active subscription' });

  await stripeService.cancelSubscription(subscription.stripe_subscription_id);

  res.json({ message: 'Subscription will cancel at end of billing period' });
}

module.exports = { getStatus, createCheckout, createPortalSession, cancel };
