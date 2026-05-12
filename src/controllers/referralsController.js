const supabase = require('../config/supabase');
const referralService = require('../services/referralService');

async function getStats(req, res) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('referral_code, referral_count, streak_count')
    .eq('id', req.user.id)
    .single();

  const { data: referrals } = await supabase
    .from('referrals')
    .select('referred_id, status, created_at, profiles:referred_id(full_name, avatar_url)')
    .eq('referrer_id', req.user.id)
    .order('created_at', { ascending: false });

  const REFERRALS_FOR_FREE = parseInt(process.env.REFERRALS_FOR_FREE_MONTH || '5', 10);
  const successfulReferrals = (referrals || []).filter((r) => r.status === 'completed').length;
  const progress = successfulReferrals % REFERRALS_FOR_FREE;

  res.json({
    referral_code: profile?.referral_code,
    referral_count: profile?.referral_count || 0,
    successful_referrals: successfulReferrals,
    progress_to_free_month: progress,
    referrals_needed: REFERRALS_FOR_FREE - progress,
    referrals,
  });
}

async function applyCode(req, res) {
  const { code } = req.body;
  if (!code) return res.status(422).json({ error: 'Referral code required' });

  const result = await referralService.applyReferral(req.user.id, code);
  if (result.error) return res.status(400).json({ error: result.error });

  res.json(result);
}

module.exports = { getStats, applyCode };
