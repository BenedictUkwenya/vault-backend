/**
 * Black Limitless Membership Structure (v1)
 * Free · Student ($8.88) · Member ($11.11) · VIP ($24.99)
 * Founding Business ($25)
 */

const PAID_TIERS = ['student', 'member', 'vip'];

const REDEMPTION_LIMITS = {
  free: 1,
  student: 10,
  member: 25,
  vip: null, // unlimited
};

const MEMBER_PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    price_label: 'Free',
    interval: 'month',
    tier: 'free',
    checkout_type: null,
    highlights: [
      'Browse all businesses',
      'View all available discounts',
      'Save favorite businesses',
      '1 discount redemption per month',
      'Participate in Passport progress',
    ],
  },
  {
    id: 'student',
    name: 'Student',
    price: 8.88,
    price_label: '$8.88/mo',
    interval: 'month',
    tier: 'student',
    checkout_type: 'student',
    highlights: [
      'Everything in Free',
      '10 discount redemptions per month',
      'Student pricing (verified student account)',
      'Participate in Passport rewards',
    ],
  },
  {
    id: 'member',
    name: 'Member',
    price: 11.11,
    price_label: '$11.11/mo',
    interval: 'month',
    tier: 'member',
    checkout_type: 'member',
    popular: true,
    highlights: [
      'Everything in Student',
      '25 discount redemptions per month',
      'Access to all standard business discounts',
      'Free entry to all Black Limitless hosted events',
      'Participate in Passport rewards',
    ],
  },
  {
    id: 'vip',
    name: 'VIP',
    price: 24.99,
    price_label: '$24.99/mo',
    interval: 'month',
    tier: 'vip',
    checkout_type: 'vip',
    highlights: [
      'Everything in Member',
      'Unlimited discount redemptions',
      'Exclusive VIP-only offers',
      'Monthly giveaway entry',
      'Early access to new app features',
      'Priority customer support',
      'VIP profile badge',
    ],
  },
];

const BUSINESS_PLAN = {
  id: 'founding_business',
  name: 'Founding Business',
  price: 25,
  price_label: '$25/mo',
  interval: 'month',
  checkout_type: 'business',
  highlights: [
    'Business profile in the app',
    '25% discount listing',
    'Access to all Member discounts while subscribed',
    'Ability to promote business information',
    'Event promotion consideration',
    'Included in Black Limitless marketing opportunities',
    'Founding Business Badge (first 100 only)',
    'Permanent placement on the Founding Business Wall',
  ],
};

function normalizeTier(tier) {
  if (tier === 'paid') return 'member';
  return tier || 'free';
}

function isPaidTier(tier) {
  return PAID_TIERS.includes(normalizeTier(tier));
}

function isVip(tier) {
  return normalizeTier(tier) === 'vip';
}

function isMembershipActive(profile) {
  if (!profile) return false;
  const tier = normalizeTier(profile.membership_tier);
  if (!isPaidTier(tier)) return false;
  if (!profile.membership_expires_at) return true;
  return new Date(profile.membership_expires_at) > new Date();
}

function effectiveTier(profile) {
  if (!isMembershipActive(profile)) return 'free';
  return normalizeTier(profile.membership_tier);
}

function redemptionLimitForTier(tier) {
  const t = normalizeTier(tier);
  return Object.prototype.hasOwnProperty.call(REDEMPTION_LIMITS, t) ? REDEMPTION_LIMITS[t] : 1;
}

function priceIdForCheckoutType(type) {
  switch (type) {
    case 'student':
      return process.env.STRIPE_STUDENT_PRICE_ID || process.env.STRIPE_MEMBER_PRICE_ID;
    case 'vip':
      return process.env.STRIPE_VIP_PRICE_ID || process.env.STRIPE_MEMBER_PRICE_ID;
    case 'business':
      return process.env.STRIPE_BUSINESS_PRICE_ID;
    case 'member':
    default:
      return process.env.STRIPE_MEMBER_PRICE_ID;
  }
}

function tierFromCheckoutType(type) {
  if (type === 'student') return 'student';
  if (type === 'vip') return 'vip';
  if (type === 'business') return null; // business sub does not set member tier
  if (type === 'member' || type === 'paid') return 'member';
  return 'member';
}

function tierFromPriceId(priceId) {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_STUDENT_PRICE_ID) return 'student';
  if (priceId === process.env.STRIPE_VIP_PRICE_ID) return 'vip';
  if (priceId === process.env.STRIPE_MEMBER_PRICE_ID) return 'member';
  if (priceId === process.env.STRIPE_BUSINESS_PRICE_ID) return null;
  return null;
}

function monthWindow() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
  return { start: start.toISOString(), end: end.toISOString() };
}

const PASSPORT_STAMPS_PER_REWARD = 5;

module.exports = {
  PAID_TIERS,
  REDEMPTION_LIMITS,
  MEMBER_PLANS,
  BUSINESS_PLAN,
  PASSPORT_STAMPS_PER_REWARD,
  normalizeTier,
  isPaidTier,
  isVip,
  isMembershipActive,
  effectiveTier,
  redemptionLimitForTier,
  priceIdForCheckoutType,
  tierFromCheckoutType,
  tierFromPriceId,
  monthWindow,
};
