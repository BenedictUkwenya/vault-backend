const supabase = require('../config/supabase');
const membership = require('./membershipService');

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
  return { ...data, just_unlocked: justUnlocked };
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

async function getProgress(userId) {
  const row = await getOrCreate(userId);
  const stamps = row.stamps_count || 0;
  const perReward = membership.PASSPORT_STAMPS_PER_REWARD;
  const towardNext = stamps % perReward;
  const rewardsUnlocked = Math.floor(stamps / perReward);
  const pageComplete = towardNext === 0 && stamps > 0;
  const filledInPage = pageComplete ? perReward : towardNext;
  const needed = pageComplete ? perReward : perReward - towardNext;

  let recent_stamps = [];
  try {
    recent_stamps = await getRecentStamps(userId);
  } catch (_) {
    recent_stamps = [];
  }

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
  };
}

module.exports = { getOrCreate, addStamp, getProgress, getRecentStamps };
