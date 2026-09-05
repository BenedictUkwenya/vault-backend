const supabase = require('../config/supabase');
const membership = require('./membershipService');

const REWARD_DEF = {
  key: 'extra_redemption',
  title: 'Bonus deal redemption',
  description:
    'Claim to add +1 deal redemption credit. Used automatically when you hit your monthly plan limit.',
};

async function getOrCreate(userId) {
  const { data: existing } = await supabase
    .from('passport_progress')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('passport_progress')
    .insert({ user_id: userId, stamps_count: 0, rewards_unlocked: 0 })
    .select()
    .single();

  if (error) throw new Error(error.message);
  return data;
}

async function ensureGrantForThreshold(userId, threshold) {
  const { data: existing } = await supabase
    .from('passport_reward_grants')
    .select('id')
    .eq('user_id', userId)
    .eq('stamp_threshold', threshold)
    .eq('reward_key', REWARD_DEF.key)
    .maybeSingle();

  if (existing) return existing;

  const { data, error } = await supabase
    .from('passport_reward_grants')
    .insert({
      user_id: userId,
      reward_key: REWARD_DEF.key,
      title: REWARD_DEF.title,
      description: REWARD_DEF.description,
      stamp_threshold: threshold,
      status: 'available',
    })
    .select()
    .single();

  // Unique race: another request inserted first
  if (error) {
    if (String(error.message || '').includes('duplicate') || error.code === '23505') {
      return existing;
    }
    throw new Error(error.message);
  }
  return data;
}

async function syncGrantsFromProgress(userId, stampsCount) {
  const per = membership.PASSPORT_STAMPS_PER_REWARD;
  const unlocked = Math.floor((stampsCount || 0) / per);
  const created = [];
  for (let i = 1; i <= unlocked; i++) {
    const threshold = i * per;
    const grant = await ensureGrantForThreshold(userId, threshold);
    if (grant) created.push(grant);
  }
  return created;
}

async function addStamp(userId) {
  const row = await getOrCreate(userId);
  const stamps = (row.stamps_count || 0) + 1;
  const rewards = Math.floor(stamps / membership.PASSPORT_STAMPS_PER_REWARD);
  const justUnlocked = stamps % membership.PASSPORT_STAMPS_PER_REWARD === 0;

  const { data, error } = await supabase
    .from('passport_progress')
    .update({
      stamps_count: stamps,
      last_stamp_at: new Date().toISOString(),
      rewards_unlocked: rewards,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)
    .select()
    .single();

  if (error) throw new Error(error.message);

  let grant = null;
  if (justUnlocked) {
    try {
      grant = await ensureGrantForThreshold(userId, stamps);
    } catch (_) {
      grant = null;
    }
  }

  return { ...data, just_unlocked: justUnlocked, grant };
}

async function getRecentStamps(userId, limit = 12) {
  const { data, error } = await supabase
    .from('redemptions')
    .select('id, verified_at, deals(title), businesses(name)')
    .eq('user_id', userId)
    .not('verified_at', 'is', null)
    .order('verified_at', { ascending: false })
    .limit(limit);

  if (error) throw new Error(error.message);

  return (data || []).map((row) => ({
    id: row.id,
    stamped_at: row.verified_at,
    deal_title: row.deals?.title || 'Deal',
    business_name: row.businesses?.name || 'Partner',
  }));
}

async function listGrants(userId) {
  const { data, error } = await supabase
    .from('passport_reward_grants')
    .select('*')
    .eq('user_id', userId)
    .order('stamp_threshold', { ascending: true });

  if (error) throw new Error(error.message);
  return data || [];
}

async function getRedemptionCredits(userId) {
  const { data } = await supabase
    .from('profiles')
    .select('passport_redemption_credits')
    .eq('id', userId)
    .maybeSingle();
  return data?.passport_redemption_credits || 0;
}

async function consumeRedemptionCredit(userId) {
  const credits = await getRedemptionCredits(userId);
  if (credits <= 0) return false;
  const { error } = await supabase
    .from('profiles')
    .update({ passport_redemption_credits: credits - 1 })
    .eq('id', userId);
  if (error) throw new Error(error.message);
  return true;
}

async function claimGrant(userId, grantId) {
  const { data: grant, error } = await supabase
    .from('passport_reward_grants')
    .select('*')
    .eq('id', grantId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!grant) throw new Error('Reward not found');
  if (grant.status !== 'available') throw new Error('This reward was already claimed');

  const credits = await getRedemptionCredits(userId);
  const { error: creditErr } = await supabase
    .from('profiles')
    .update({ passport_redemption_credits: credits + 1 })
    .eq('id', userId);
  if (creditErr) throw new Error(creditErr.message);

  const { data: updated, error: updErr } = await supabase
    .from('passport_reward_grants')
    .update({ status: 'claimed', claimed_at: new Date().toISOString() })
    .eq('id', grantId)
    .eq('user_id', userId)
    .eq('status', 'available')
    .select()
    .single();

  if (updErr) {
    // Roll back credit if claim race lost
    await supabase.from('profiles').update({ passport_redemption_credits: credits }).eq('id', userId);
    throw new Error(updErr.message);
  }

  return {
    grant: updated,
    passport_redemption_credits: credits + 1,
    message: 'Bonus redemption credit added to your account.',
  };
}

async function getProgress(userId) {
  const row = await getOrCreate(userId);
  const stamps = row.stamps_count || 0;
  const perReward = membership.PASSPORT_STAMPS_PER_REWARD;
  const towardNext = stamps % perReward;
  const rewardsUnlocked = Math.floor(stamps / perReward);
  const pageComplete = towardNext === 0 && stamps > 0;
  const filledInPage = pageComplete ? perReward : towardNext;
  const needed = pageComplete ? perReward : perReward - towardNext;

  try {
    await syncGrantsFromProgress(userId, stamps);
  } catch (_) {
    /* grants table may not be migrated yet */
  }

  let recent_stamps = [];
  try {
    recent_stamps = await getRecentStamps(userId);
  } catch (_) {
    recent_stamps = [];
  }

  let rewards = [];
  let credits = 0;
  try {
    rewards = await listGrants(userId);
    credits = await getRedemptionCredits(userId);
  } catch (_) {
    rewards = [];
    credits = 0;
  }

  const available = rewards.filter((r) => r.status === 'available');

  return {
    user_id: row.user_id,
    stamps_count: stamps,
    rewards_unlocked: Math.max(row.rewards_unlocked || 0, rewardsUnlocked),
    last_stamp_at: row.last_stamp_at,
    updated_at: row.updated_at,
    stamps_per_reward: perReward,
    stamps_toward_next_reward: towardNext,
    stamps_filled_in_page: filledInPage,
    stamps_needed_for_next: needed,
    page_complete: pageComplete,
    recent_stamps,
    rewards,
    rewards_available: available.length,
    passport_redemption_credits: credits,
    reward_catalog: [REWARD_DEF],
  };
}

module.exports = {
  getOrCreate,
  addStamp,
  getProgress,
  getRecentStamps,
  listGrants,
  claimGrant,
  getRedemptionCredits,
  consumeRedemptionCredit,
  REWARD_DEF,
};
