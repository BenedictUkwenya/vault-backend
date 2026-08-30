const supabase = require('../config/supabase');
const referralService = require('../services/referralService');

async function getStats(req, res) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('referral_code, referral_count, streak_count, role, ambassador_unlocked_at')
    .eq('id', req.user.id)
    .single();

  const invitees = await referralService.getInviteeMilestones(req.user.id);
  const successfulReferrals = invitees.filter((r) => r.status === 'completed').length;
  const progress = successfulReferrals % referralService.REFERRALS_FOR_FREE;
  const urls = referralService.shareUrls(profile?.referral_code);

  const { data: ledger } = await supabase
    .from('ambassador_rewards')
    .select('amount, status')
    .eq('user_id', req.user.id);

  const pendingRewards = (ledger || [])
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  const portalUnlocked =
    !!profile?.ambassador_unlocked_at ||
    profile?.role === 'ambassador' ||
    invitees.length > 0;

  res.json({
    referral_code: profile?.referral_code,
    referral_count: profile?.referral_count || 0,
    successful_referrals: successfulReferrals,
    pending_invites: invitees.filter((r) => r.status === 'pending').length,
    progress_to_free_month: progress,
    referrals_needed: referralService.REFERRALS_FOR_FREE - progress,
    referrals_for_free_month: referralService.REFERRALS_FOR_FREE,
    pending_rewards: pendingRewards,
    portal_unlocked: portalUnlocked,
    share: urls,
    reward_catalog: referralService.REWARD_CATALOG,
    referrals: invitees,
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
