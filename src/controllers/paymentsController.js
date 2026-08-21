const stripe = require('../config/stripe');
const supabase = require('../config/supabase');
const logger = require('../config/logger');
const referralService = require('../services/referralService');
const membership = require('../services/membershipService');

async function webhook(req, res) {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    logger.warn('Stripe webhook signature verification failed', { error: err.message });
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await handleSubscriptionUpsert(event.data.object);
        break;
      }
      case 'customer.subscription.deleted': {
        await handleSubscriptionDeleted(event.data.object);
        break;
      }
      case 'invoice.payment_succeeded': {
        await handlePaymentSucceeded(event.data.object);
        break;
      }
      case 'invoice.payment_failed': {
        await handlePaymentFailed(event.data.object);
        break;
      }
      default:
        logger.info(`Unhandled Stripe event: ${event.type}`);
    }
  } catch (err) {
    logger.error('Error processing webhook event', { event: event.type, error: err.message });
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  res.json({ received: true });
}

function resolveSubMeta(sub) {
  const metaType = sub.metadata?.subscriptionType || sub.metadata?.subscription_type;
  const priceId = sub.items?.data?.[0]?.price?.id;
  const fromPrice = membership.tierFromPriceId(priceId);
  const isBusiness = metaType === 'business' || priceId === process.env.STRIPE_BUSINESS_PRICE_ID;
  const memberTier = isBusiness
    ? null
    : membership.tierFromCheckoutType(metaType) || fromPrice || 'member';
  return { isBusiness, memberTier, priceId, metaType: metaType || (isBusiness ? 'business' : 'member') };
}

async function handleSubscriptionUpsert(sub) {
  const customerId = sub.customer;
  const isActive = sub.status === 'active' || sub.status === 'trialing';
  const { isBusiness, memberTier, metaType } = resolveSubMeta(sub);

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!profile) {
    logger.warn('No profile found for Stripe customer', { customerId });
    return;
  }

  const expiresAt =
    isActive && sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null;

  if (isBusiness) {
    await supabase
      .from('businesses')
      .update({
        subscription_status: isActive ? 'active' : 'none',
        subscription_expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      })
      .eq('owner_id', profile.id);
  } else {
    await supabase
      .from('profiles')
      .update({
        membership_tier: isActive ? memberTier : 'free',
        membership_expires_at: expiresAt,
        ...(isActive ? { preferred_membership_tier: null } : {}),
      })
      .eq('id', profile.id);
  }

  await supabase.from('subscriptions').upsert(
    {
      user_id: profile.id,
      stripe_subscription_id: sub.id,
      stripe_customer_id: customerId,
      status: sub.status,
      subscription_type: metaType,
      current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
      current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
      cancel_at_period_end: sub.cancel_at_period_end,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'stripe_subscription_id' }
  );

  if (isActive && !isBusiness) {
    await referralService.completeReferral(profile.id);
  }
}

async function handleSubscriptionDeleted(sub) {
  const customerId = sub.customer;
  const { isBusiness } = resolveSubMeta(sub);

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!profile) return;

  if (isBusiness) {
    await supabase
      .from('businesses')
      .update({
        subscription_status: 'none',
        subscription_expires_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq('owner_id', profile.id);
  } else {
    await supabase
      .from('profiles')
      .update({
        membership_tier: 'free',
        membership_expires_at: null,
      })
      .eq('id', profile.id);
  }

  await supabase
    .from('subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', sub.id);
}

async function handlePaymentSucceeded(invoice) {
  logger.info('Payment succeeded', { invoice: invoice.id, customer: invoice.customer });

  const customerId = invoice.customer;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (profile) {
    await referralService.completeReferral(profile.id);
  }
}

async function handlePaymentFailed(invoice) {
  const customerId = invoice.customer;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!profile) return;

  await supabase.from('notifications').insert({
    user_id: profile.id,
    title: 'Payment Failed',
    body: 'Your Black Limitless membership payment failed. Please update your payment method.',
    type: 'payment',
  });
}

module.exports = { webhook };
