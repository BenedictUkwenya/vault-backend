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
  const { count, error } = await supabase
    .from('referrals')
    .select('id', { count: 'exact', head: true })
    .eq('referrer_id', req.user.id)
    .eq('status', 'completed');

  if (error) return res.status(400).json({ error: error.message });

  res.json({
    reward_unit: 'completed_referral',
    completed_referrals: count || 0,
    pending_rewards: count || 0,
    ledger: [],
  });
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
};
