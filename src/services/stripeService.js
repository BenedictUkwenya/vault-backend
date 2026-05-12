const stripe = require('../config/stripe');
const supabase = require('../config/supabase');

async function getOrCreateCustomer(userId, email, existingCustomerId) {
  if (existingCustomerId) return existingCustomerId;

  const customer = await stripe.customers.create({ email, metadata: { userId } });

  await supabase
    .from('profiles')
    .update({ stripe_customer_id: customer.id })
    .eq('id', userId);

  return customer.id;
}

async function createCheckoutSession({ customerId, priceId, successUrl, cancelUrl, userId, subscriptionType }) {
  return stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ['card'],
    mode: 'subscription',
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: successUrl,
    cancel_url: cancelUrl,
    metadata: { userId, subscriptionType },
    subscription_data: {
      metadata: { userId, subscriptionType },
    },
  });
}

async function createPortalSession(customerId, returnUrl) {
  return stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
}

async function cancelSubscription(subscriptionId) {
  return stripe.subscriptions.update(subscriptionId, {
    cancel_at_period_end: true,
  });
}

async function cancelSubscriptionImmediately(subscriptionId) {
  return stripe.subscriptions.cancel(subscriptionId);
}

module.exports = {
  getOrCreateCustomer,
  createCheckoutSession,
  createPortalSession,
  cancelSubscription,
  cancelSubscriptionImmediately,
};
