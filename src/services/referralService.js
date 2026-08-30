const supabase = require('../config/supabase');
const crypto = require('crypto');

const REFERRALS_FOR_FREE = parseInt(process.env.REFERRALS_FOR_FREE_MONTH || '5', 10);

/** Pending ledger amounts (USD) — overridable via env */
const REWARD_AMOUNTS = {
  subscribe: Number(process.env.REFERRAL_REWARD_SUBSCRIBE || 10),
  deal: Number(process.env.REFERRAL_REWARD_DEAL || 3),
  booking: Number(process.env.REFERRAL_REWARD_BOOKING || 5),
};

const REWARD_CATALOG = [
  {
    event_key: 'signup',
    label: 'Accepts your invite',
    description: 'They create an account with your code',
    amount: 0,
    unlocks_portal: true,
  },
  {
    event_key: 'subscribe',
    label: 'First paid membership',
    description: 'They subscribe to Student, Member, or VIP',
    amount: REWARD_AMOUNTS.subscribe,
  },
  {
    event_key: 'deal',
    label: 'First verified deal',
    description: 'A partner scans and verifies their deal',
    amount: REWARD_AMOUNTS.deal,
  },
  {
    event_key: 'booking',
    label: 'First completed booking',
    description: 'A business marks their visit complete',
    amount: REWARD_AMOUNTS.booking,
  },
];

function generateCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

function referralWebBase() {
  return (
    process.env.REFERRAL_LANDING_BASE_URL ||
    process.env.FRONTEND_URL ||
    'https://www.blacklimitless.com'
  ).replace(/\/$/, '');
}

function shareUrls(code) {
  if (!code) return { web_url: null, deep_link: null };
  const normalized = String(code).trim().toUpperCase();
  return {
    web_url: `${referralWebBase()}/ref/${normalized}`,
    deep_link: `blacklimitless://ref/${normalized}`,
  };
}

async function unlockAmbassador(referrerId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, role, ambassador_unlocked_at')
    .eq('id', referrerId)
    .maybeSingle();

  if (!profile) return { unlocked: false };

  const patch = {};
  if (!profile.ambassador_unlocked_at) {
    patch.ambassador_unlocked_at = new Date().toISOString();
  }
  if (profile.role === 'user') {
    patch.role = 'ambassador';
  }

  if (Object.keys(patch).length) {
    await supabase.from('profiles').update(patch).eq('id', referrerId);
  }

  if (!profile.ambassador_unlocked_at) {
    try {
      const notificationService = require('./notificationService');
      await notificationService.createNotification({
        userId: referrerId,
        title: 'Ambassador Portal unlocked',
        body: 'Someone joined with your invite. Open the Ambassador Portal to track rewards.',
        type: 'referral',
      });
    } catch (_) {}
  }

  return { unlocked: true, role: patch.role || profile.role };
}

async function applyReferral(newUserId, code) {
  const normalizedCode = String(code || '').trim().toUpperCase();
  if (!normalizedCode) return { error: 'Referral code required' };

  const { data: referrer } = await supabase
    .from('profiles')
    .select('id, role')
    .eq('referral_code', normalizedCode)
    .maybeSingle();

  if (!referrer) return { error: 'Invalid referral code' };
  if (referrer.id === newUserId) return { error: 'Cannot use your own referral code' };

  const { data: existing } = await supabase
    .from('referrals')
    .select('id')
    .eq('referred_id', newUserId)
    .maybeSingle();

  if (existing) return { error: 'Referral code already applied' };

  const { error } = await supabase.from('referrals').insert({
    referrer_id: referrer.id,
    referred_id: newUserId,
    referral_code: normalizedCode,
    status: 'pending',
  });

  if (error) return { error: error.message };

  await unlockAmbassador(referrer.id);

  return { success: true, referrer_id: referrer.id };
}

async function awardFreeMonth(userId) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('membership_expires_at, membership_tier')
    .eq('id', userId)
    .single();

  const baseDate =
    profile?.membership_expires_at && new Date(profile.membership_expires_at) > new Date()
      ? new Date(profile.membership_expires_at)
      : new Date();

  const newExpiry = new Date(baseDate);
  newExpiry.setMonth(newExpiry.getMonth() + 1);

  await supabase
    .from('profiles')
    .update({
      membership_tier: 'member',
      membership_expires_at: newExpiry.toISOString(),
    })
    .eq('id', userId);

  try {
    const notificationService = require('./notificationService');
    await notificationService.createNotification({
      userId,
      title: 'Free Month Earned!',
      body: 'You earned a free month of Black Limitless Member access for your referrals!',
      type: 'referral',
    });
  } catch (_) {}
}

/**
 * Record a milestone for the person who referred `referredUserId`.
 * eventKey: 'subscribe' | 'deal' | 'booking'
 */
async function recordReferralEvent(referredUserId, eventKey) {
  if (!['subscribe', 'deal', 'booking'].includes(eventKey)) return { ok: false, reason: 'invalid_event' };

  const { data: referral } = await supabase
    .from('referrals')
    .select('id, referrer_id, status')
    .eq('referred_id', referredUserId)
    .maybeSingle();

  if (!referral) return { ok: false, reason: 'no_referral' };

  const amount = REWARD_AMOUNTS[eventKey] || 0;
  const { error: insertError } = await supabase.from('ambassador_rewards').insert({
    user_id: referral.referrer_id,
    referred_user_id: referredUserId,
    event_key: eventKey,
    amount,
    reward_type: eventKey,
    status: 'pending',
    notes: `${eventKey} reward for referred user ${referredUserId}`,
  });

  // Unique violation = already rewarded this milestone
  if (insertError) {
    if (insertError.code === '23505') return { ok: true, duplicate: true };
    return { ok: false, reason: insertError.message };
  }

  await unlockAmbassador(referral.referrer_id);

  if (eventKey === 'subscribe' && referral.status === 'pending') {
    await supabase
      .from('referrals')
      .update({ status: 'completed', completed_at: new Date().toISOString() })
      .eq('id', referral.id);

    const { data: referrer } = await supabase
      .from('profiles')
      .select('referral_count')
      .eq('id', referral.referrer_id)
      .single();

    const newCount = (referrer?.referral_count || 0) + 1;
    await supabase
      .from('profiles')
      .update({ referral_count: newCount })
      .eq('id', referral.referrer_id);

    if (newCount % REFERRALS_FOR_FREE === 0) {
      await awardFreeMonth(referral.referrer_id);
    }
  }

  try {
    const notificationService = require('./notificationService');
    const label = REWARD_CATALOG.find((c) => c.event_key === eventKey)?.label || eventKey;
    await notificationService.createNotification({
      userId: referral.referrer_id,
      title: amount > 0 ? `+$${amount.toFixed(0)} ambassador reward` : 'Invite milestone',
      body: `Your invite hit: ${label}.`,
      type: 'referral',
    });
  } catch (_) {}

  return { ok: true, amount, referrer_id: referral.referrer_id };
}

/** @deprecated use recordReferralEvent(id, 'subscribe') */
async function completeReferral(referredUserId) {
  return recordReferralEvent(referredUserId, 'subscribe');
}

async function getInviteeMilestones(referrerId) {
  const [{ data: referrals }, { data: rewards }] = await Promise.all([
    supabase
      .from('referrals')
      .select(
        'id, referred_id, status, created_at, completed_at, profiles:referred_id(full_name, avatar_url, membership_tier)'
      )
      .eq('referrer_id', referrerId)
      .order('created_at', { ascending: false }),
    supabase
      .from('ambassador_rewards')
      .select('referred_user_id, event_key, amount, status, created_at')
      .eq('user_id', referrerId)
      .not('event_key', 'is', null),
  ]);

  const byUser = {};
  for (const r of rewards || []) {
    if (!r.referred_user_id) continue;
    if (!byUser[r.referred_user_id]) byUser[r.referred_user_id] = {};
    byUser[r.referred_user_id][r.event_key] = {
      amount: Number(r.amount || 0),
      status: r.status,
      at: r.created_at,
    };
  }

  return (referrals || []).map((row) => {
    const events = byUser[row.referred_id] || {};
    return {
      id: row.id,
      referred_id: row.referred_id,
      status: row.status,
      created_at: row.created_at,
      completed_at: row.completed_at,
      full_name: row.profiles?.full_name || 'Member',
      avatar_url: row.profiles?.avatar_url || null,
      membership_tier: row.profiles?.membership_tier || 'free',
      milestones: {
        signup: true,
        subscribe: !!events.subscribe,
        deal: !!events.deal,
        booking: !!events.booking,
      },
      earned: Object.values(events).reduce((sum, e) => sum + Number(e.amount || 0), 0),
    };
  });
}

module.exports = {
  generateCode,
  applyReferral,
  completeReferral,
  recordReferralEvent,
  awardFreeMonth,
  unlockAmbassador,
  shareUrls,
  getInviteeMilestones,
  REWARD_CATALOG,
  REWARD_AMOUNTS,
  REFERRALS_FOR_FREE,
};
