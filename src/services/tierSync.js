const supabase = require('../config/supabase');
const membership = require('./membershipService');

const TIER_RANK = { free: 0, student: 1, member: 2, vip: 3 };

function higher(a, b) {
  if (!a) return b;
  if (!b) return a;
  return (TIER_RANK[b.tier] || 0) > (TIER_RANK[a.tier] || 0) ? b : a;
}

/**
 * profiles.membership_tier is derived from two sources:
 *  - Stripe: the best live member subscription
 *  - Complimentary: admin grants and referral free months (comp_tier / comp_expires_at)
 * Recomputing from both means a Stripe renewal no longer wipes an admin grant,
 * and a referral free month no longer downgrades a VIP.
 */
async function syncEffectiveTier(userId) {
  const [{ data: subs, error: subsErr }, { data: profile, error: profErr }] = await Promise.all([
    supabase
      .from('subscriptions')
      .select('subscription_type, status, current_period_end')
      .eq('user_id', userId)
      .in('status', ['active', 'trialing', 'past_due'])
      .neq('subscription_type', 'business'),
    supabase.from('profiles').select('comp_tier, comp_expires_at').eq('id', userId).maybeSingle(),
  ]);
  if (subsErr) throw new Error(`load subscriptions: ${subsErr.message}`);
  if (profErr) throw new Error(`load profile: ${profErr.message}`);

  let best = null;
  for (const s of subs || []) {
    best = higher(best, { tier: membership.normalizeTier(s.subscription_type), expiresAt: s.current_period_end });
  }

  const compActive =
    profile?.comp_tier &&
    profile.comp_tier !== 'free' &&
    (!profile.comp_expires_at || new Date(profile.comp_expires_at) > new Date());
  if (compActive) {
    best = higher(best, { tier: profile.comp_tier, expiresAt: profile.comp_expires_at || null });
  }

  const patch = {
    membership_tier: best ? best.tier : 'free',
    membership_expires_at: best ? best.expiresAt : null,
  };
  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw new Error(`update profile tier: ${error.message}`);
  return patch;
}

module.exports = { syncEffectiveTier, TIER_RANK };
