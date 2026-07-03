const supabase = require('../config/supabase');

async function getDashboard(req, res) {
  const [profileResult, referralsResult] = await Promise.all([
    supabase
      .from('profiles')
      .select('referral_code, referral_count, streak_count')
      .eq('id', req.user.id)
      .single(),
    supabase
      .from('referrals')
      .select('id, referred_id, status, completed_at, created_at')
      .eq('referrer_id', req.user.id)
      .order('created_at', { ascending: false }),
  ]);

  const referrals = referralsResult.data || [];
  const completed = referrals.filter((referral) => referral.status === 'completed');

  res.json({
    profile: profileResult.data,
    stats: {
      total_referrals: referrals.length,
      completed_referrals: completed.length,
      pending_referrals: referrals.length - completed.length,
      estimated_rewards: completed.length,
    },
    recent_referrals: referrals.slice(0, 10),
  });
}

async function getReferrals(req, res) {
  const { data, error } = await supabase
    .from('referrals')
    .select('id, referred_id, referral_code, status, completed_at, created_at, profiles:referred_id(full_name, avatar_url)')
    .eq('referrer_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });

  res.json({ referrals: data || [] });
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
      .limit(50),
  ]);

  if (countError) return res.status(400).json({ error: countError.message });
  if (ledgerError && ledgerError.code !== '42P01') return res.status(400).json({ error: ledgerError.message });

  const completed = count || 0;
  const pendingAmount = (ledger || [])
    .filter((r) => r.status === 'pending')
    .reduce((sum, r) => sum + Number(r.amount || 0), 0);

  res.json({
    reward_unit: 'completed_referral',
    completed_referrals: completed,
    pending_rewards: pendingAmount,
    ledger: ledger || [],
  });
}

async function getLeaderboard(_req, res) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, referral_count, streak_count')
    .in('role', ['ambassador', 'user'])
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
  });
}

async function getCampaigns(req, res) {
  const code = req.profile?.referral_code;

  res.json({
    campaigns: [
      {
        id: 'default-referral',
        name: 'Vault Member Invite',
        status: 'active',
        referral_code: code,
        share_url: code ? `https://joinvault.app/ref/${code}` : null,
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
