const stripe = require('../config/stripe');
const supabase = require('../config/supabase');
const logger = require('../config/logger');

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
        const sub = event.data.object;
        await handleSubscriptionUpsert(sub);
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        await handleSubscriptionDeleted(sub);
        break;
      }
      case 'invoice.payment_succeeded': {
        const invoice = event.data.object;
        await handlePaymentSucceeded(invoice);
        break;
      }
      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        await handlePaymentFailed(invoice);
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

async function handleSubscriptionUpsert(sub) {
  const customerId = sub.customer;
  const isActive = sub.status === 'active' || sub.status === 'trialing';

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!profile) {
    logger.warn('No profile found for Stripe customer', { customerId });
    return;
  }

  const expiresAt = isActive && sub.current_period_end
    ? new Date(sub.current_period_end * 1000).toISOString()
    : null;

  await supabase.from('profiles').update({
    membership_tier: isActive ? 'paid' : 'free',
    membership_expires_at: expiresAt,
  }).eq('id', profile.id);

  await supabase.from('subscriptions').upsert({
    user_id: profile.id,
    stripe_subscription_id: sub.id,
    stripe_customer_id: customerId,
    status: sub.status,
    current_period_start: new Date(sub.current_period_start * 1000).toISOString(),
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    cancel_at_period_end: sub.cancel_at_period_end,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'stripe_subscription_id' });
}

async function handleSubscriptionDeleted(sub) {
  const customerId = sub.customer;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!profile) return;

  await supabase.from('profiles').update({
    membership_tier: 'free',
    membership_expires_at: null,
  }).eq('id', profile.id);

  await supabase.from('subscriptions')
    .update({ status: 'canceled', updated_at: new Date().toISOString() })
    .eq('stripe_subscription_id', sub.id);
}

async function handlePaymentSucceeded(invoice) {
  logger.info('Payment succeeded', { invoice: invoice.id, customer: invoice.customer });
}

async function handlePaymentFailed(invoice) {
  const customerId = invoice.customer;

  const { data: profile } = await supabase
    .from('profiles')
    .select('id')
    .eq('stripe_customer_id', customerId)
    .single();

  if (!profile) return;

  // Notify user of payment failure
  await supabase.from('notifications').insert({
    user_id: profile.id,
    title: 'Payment Failed',
    body: 'Your Vault membership payment failed. Please update your payment method.',
    type: 'payment',
  });
}

module.exports = { webhook };
