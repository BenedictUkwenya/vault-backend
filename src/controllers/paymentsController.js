const stripe = require('../config/stripe');
const supabase = require('../config/supabase');
const logger = require('../config/logger');
const referralService = require('../services/referralService');
const membership = require('../services/membershipService');
const notificationService = require('../services/notificationService');
const { syncEffectiveTier } = require('../services/tierSync');

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

/** Supabase returns errors instead of throwing; throw so Stripe gets a 500 and retries. */
function must(result, what) {
  if (result?.error) throw new Error(`${what}: ${result.error.message}`);
  return result;
}

/**
 * The tier comes from the price actually paid. Metadata is client-influenced at
 * checkout time, so it may only ever lower the tier, never raise it to VIP.
 */
function resolveSubMeta(sub) {
  const metaType = sub.metadata?.subscriptionType || sub.metadata?.subscription_type;
  const priceId = sub.items?.data?.[0]?.price?.id;
  const fromPrice = membership.tierFromPriceId(priceId);
  const isBusiness = priceId
    ? priceId === process.env.STRIPE_BUSINESS_PRICE_ID
    : metaType === 'business';
  let memberTier = null;
  if (!isBusiness) {
    memberTier = fromPrice || (metaType === 'student' ? 'student' : 'member');
    if (memberTier === 'vip' && !fromPrice) memberTier = 'member';
  }
  return { isBusiness, memberTier, priceId, metaType: isBusiness ? 'business' : memberTier };
}

// past_due keeps access during Stripe's retry window instead of dropping to Free
// on the first failed charge.
function subscriptionGrantsAccess(status) {
  return status === 'active' || status === 'trialing' || status === 'past_due';
}

async function handleSubscriptionUpsert(sub) {
  const customerId = sub.customer;
  const isActive = subscriptionGrantsAccess(sub.status);
  const { isBusiness, metaType } = resolveSubMeta(sub);

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (!profile) {
    logger.warn('No profile found for Stripe customer', { customerId });
    return;
  }

  const expiresAt =
    isActive && sub.current_period_end
      ? new Date(sub.current_period_end * 1000).toISOString()
      : null;

  must(
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
    ),
    'upsert subscription'
  );

  if (isBusiness) {
    must(
      await supabase
        .from('businesses')
        .update({
          subscription_status: isActive ? 'active' : 'none',
          subscription_expires_at: expiresAt,
          updated_at: new Date().toISOString(),
        })
        .eq('owner_id', profile.id),
      'update business subscription'
    );
  } else {
    await syncEffectiveTier(profile.id);
    if (isActive) {
      await supabase.from('profiles').update({ preferred_membership_tier: null }).eq('id', profile.id);
    }
  }

  // Trials grant access but don't count as a paid referral until the first charge.
  if (sub.status === 'active' && !isBusiness) {
    await referralService.recordReferralEvent(profile.id, 'subscribe');
  }
}

async function handleSubscriptionDeleted(sub) {
  const customerId = sub.customer;
  const { isBusiness } = resolveSubMeta(sub);

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .maybeSingle();

  if (!profile) return;

  must(
    await supabase
      .from('subscriptions')
      .update({ status: 'canceled', updated_at: new Date().toISOString() })
      .eq('stripe_subscription_id', sub.id),
    'mark subscription canceled'
  );

  if (isBusiness) {
    must(
      await supabase
        .from('businesses')
        .update({
          subscription_status: 'none',
          subscription_expires_at: null,
          updated_at: new Date().toISOString(),
        })
        .eq('owner_id', profile.id),
      'clear business subscription'
    );
  } else {
    // Another live subscription or a complimentary grant may still apply.
    await syncEffectiveTier(profile.id);
  }
}

async function handlePaymentSucceeded(invoice) {
  logger.info('Payment succeeded', { invoice: invoice.id, customer: invoice.customer });

  const customerId = invoice.customer;
  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  // A trial start produces a $0 invoice, which is not a paid subscription.
  if (profile && invoice.amount_paid > 0) {
    await referralService.recordReferralEvent(profile.id, 'subscribe');
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

  try {
    await notificationService.createNotification({
      userId: profile.id,
      title: 'Payment Failed',
      body: 'Your Black Limitless membership payment failed. Please update your payment method.',
      type: 'payment',
    });
  } catch (_) {}
}

module.exports = { webhook };
