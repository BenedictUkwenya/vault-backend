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
  return data;
}

async function getProgress(userId) {
  const row = await getOrCreate(userId);
  const stamps = row.stamps_count || 0;
  const perReward = membership.PASSPORT_STAMPS_PER_REWARD;
  const towardNext = stamps % perReward;
  return {
    ...row,
    stamps_count: stamps,
    stamps_per_reward: perReward,
    stamps_toward_next_reward: towardNext,
    stamps_needed_for_next: towardNext === 0 && stamps > 0 ? perReward : perReward - towardNext,
  };
}

module.exports = { getOrCreate, addStamp, getProgress };
