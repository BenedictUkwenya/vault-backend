const supabase = require('../config/supabase');
const referralService = require('../services/referralService');

async function getDashboard(req, res) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('referral_code, referral_count, streak_count, role, ambassador_unlocked_at')
    .eq('id', req.user.id)
    .single();

  const invitees = await referralService.getInviteeMilestones(req.user.id);
  const completed = invitees.filter((r) => r.status === 'completed');
  const urls = referralService.shareUrls(profile?.referral_code);

  const { data: ledger } = await supabase
    .from('ambassador_rewards')
    .select('amount, status, event_key')
    .eq('user_id', req.user.id);

  const pendingAmount = (ledger || [])
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);
  const earnedAmount = (ledger || []).reduce((sum, r) => sum + Number(r.amount || 0), 0);

  res.json({
    profile: {
      referral_code: profile?.referral_code,
      referral_count: profile?.referral_count || 0,
      streak_count: profile?.streak_count || 0,
      role: profile?.role,
      ambassador_unlocked_at: profile?.ambassador_unlocked_at,
    },
    stats: {
      total_referrals: invitees.length,
      completed_referrals: completed.length,
      pending_referrals: invitees.length - completed.length,
      pending_rewards: pendingAmount,
      earned_rewards: earnedAmount,
      progress_to_free_month: completed.length % referralService.REFERRALS_FOR_FREE,
      referrals_needed:
        referralService.REFERRALS_FOR_FREE - (completed.length % referralService.REFERRALS_FOR_FREE),
      referrals_for_free_month: referralService.REFERRALS_FOR_FREE,
    },
    share: urls,
    reward_catalog: referralService.REWARD_CATALOG,
    recent_referrals: invitees.slice(0, 10),
  });
}

async function getReferrals(req, res) {
  const invitees = await referralService.getInviteeMilestones(req.user.id);
  res.json({ referrals: invitees });
}

async function getRewards(req, res) {
  const [{ count, error: countError }, { data: ledger, error: ledgerError }] = await Promise.all([
    supabase
      .from('referrals')
      .select('id', { count: 'exact', head: true })
      .eq('referrer_id', req.user.id)
      .eq('status', 'completed'),
    supabase
      .from('ambassador_rewards')
      .select('*')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .limit(100),
  ]);

  if (countError) return res.status(400).json({ error: countError.message });
  if (ledgerError && ledgerError.code !== '42P01') return res.status(400).json({ error: ledgerError.message });

  const pendingAmount = (ledger || [])
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  res.json({
    reward_unit: 'usd',
    completed_referrals: count || 0,
    pending_rewards: pendingAmount,
    earned_rewards: (ledger || []).reduce((sum, r) => sum + Number(r.amount || 0), 0),
    reward_catalog: referralService.REWARD_CATALOG,
    ledger: ledger || [],
  });
}

async function getLeaderboard(_req, res) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, referral_count, streak_count')
    .or('role.eq.ambassador,ambassador_unlocked_at.not.is.null,referral_count.gt.0')
    .order('referral_count', { ascending: false })
    .limit(20);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ leaderboard: data || [] });
}

async function getPayouts(_req, res) {
  res.json({
    status: 'not_configured',
    payout_method: null,
    pending_amount: 0,
    payouts: [],
    message: 'Cash payouts are coming soon. Your rewards are tracked in the ledger.',
  });
}

async function getCampaigns(req, res) {
  const code = req.profile?.referral_code;
  const urls = referralService.shareUrls(code);

  res.json({
    campaigns: [
      {
        id: 'default-referral',
        name: 'Black Limitless Member Invite',
        status: 'active',
        referral_code: code,
        share_url: urls.web_url,
        deep_link: urls.deep_link,
        reward_catalog: referralService.REWARD_CATALOG,
      },
    ],
  });
}

module.exports = {
  getDashboard,
  getReferrals,
  getRewards,
  getPayouts,
  getCampaigns,
  getLeaderboard,
};
