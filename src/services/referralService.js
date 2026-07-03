const supabase = require('../config/supabase');
const crypto = require('crypto');

function generateCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

async function applyReferral(newUserId, code) {
  const normalizedCode = code.trim().toUpperCase();

  // Find referrer by code
  const { data: referrer } = await supabase
    .from('profiles')
    .select('id')
    .eq('referral_code', normalizedCode)
    .single();

  if (!referrer) return { error: 'Invalid referral code' };
  if (referrer.id === newUserId) return { error: 'Cannot use your own referral code' };

  // Check if already used
  const { data: existing } = await supabase
    .from('referrals')
    .select('id')
    .eq('referred_id', newUserId)
    .single();

  if (existing) return { error: 'Referral code already applied' };

  // Record referral
  await supabase.from('referrals').insert({
    referrer_id: referrer.id,
    referred_id: newUserId,
    referral_code: normalizedCode,
    status: 'pending',
  });

  return { success: true, referrer_id: referrer.id };
}

async function completeReferral(referredUserId) {
  const { data: referral } = await supabase
    .from('referrals')
    .select('id, referrer_id')
    .eq('referred_id', referredUserId)
    .eq('status', 'pending')
    .single();

  if (!referral) return;

  await supabase
    .from('referrals')
    .update({ status: 'completed', completed_at: new Date().toISOString() })
    .eq('id', referral.id);

  // Increment referral count on referrer
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

  // Award free month every N referrals
  const REFERRALS_FOR_FREE = parseInt(process.env.REFERRALS_FOR_FREE_MONTH || '5', 10);
  if (newCount % REFERRALS_FOR_FREE === 0) {
    await awardFreeMonth(referral.referrer_id);
  }

  // Ambassador rewards ledger entry
  try {
    await supabase.from('ambassador_rewards').insert({
      user_id: referral.referrer_id,
      amount: 5,
      reward_type: 'referral',
      status: 'pending',
      notes: `Referral completed for user ${referredUserId}`,
    });
  } catch (_) {}
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

  await supabase.from('profiles').update({
    membership_tier: 'paid',
    membership_expires_at: newExpiry.toISOString(),
  }).eq('id', userId);

  await supabase.from('notifications').insert({
    user_id: userId,
    title: 'Free Month Earned!',
    body: 'You earned a free month of Vault membership for your referrals!',
    type: 'referral',
  });
}

module.exports = { generateCode, applyReferral, completeReferral, awardFreeMonth };
