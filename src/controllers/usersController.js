const supabase = require('../config/supabase');

async function getProfile(req, res) {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

  if (error) return res.status(404).json({ error: 'Profile not found' });
  res.json(data);
}

async function updateProfile(req, res) {
  const { full_name, avatar_url, city } = req.body;
  const updates = {};
  if (full_name !== undefined) updates.full_name = full_name;
  if (avatar_url !== undefined) updates.avatar_url = avatar_url;
  if (city !== undefined) updates.city = city;

  const { data, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', req.user.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function getSavings(req, res) {
  const { data } = await supabase
    .from('redemptions')
    .select('savings_amount')
    .eq('user_id', req.user.id);

  const total = (data || []).reduce((sum, r) => sum + (r.savings_amount || 0), 0);
  res.json({ total_savings: total, redemption_count: (data || []).length });
}

async function getFavorites(req, res) {
  const { data, error } = await supabase
    .from('user_favorites')
    .select('business_id, businesses(*)')
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data.map((f) => f.businesses));
}

async function toggleFavorite(req, res) {
  const { businessId } = req.params;
  const userId = req.user.id;

  const { data: existing } = await supabase
    .from('user_favorites')
    .select('id')
    .eq('user_id', userId)
    .eq('business_id', businessId)
    .single();

  if (existing) {
    await supabase
      .from('user_favorites')
      .delete()
      .eq('user_id', userId)
      .eq('business_id', businessId);
    return res.json({ favorited: false });
  }

  await supabase
    .from('user_favorites')
    .insert({ user_id: userId, business_id: businessId });
  res.json({ favorited: true });
}

async function walletHistory(req, res) {
  const { page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('redemptions')
    .select(
      'id, savings_amount, redeemed_at, deals(title, discount_percentage), businesses(name, logo_url)',
      { count: 'exact' }
    )
    .eq('user_id', req.user.id)
    .order('redeemed_at', { ascending: false })
    .range(offset, offset + Number(limit) - 1);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ history: data || [], total: count || 0, page: Number(page) });
}

async function savePushToken(req, res) {
  const { token } = req.body;
  if (!token) return res.status(422).json({ error: 'token required' });

  const { data, error } = await supabase
    .from('profiles')
    .update({ push_token: token, updated_at: new Date().toISOString() })
    .eq('id', req.user.id)
    .select('id, push_token')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function deleteAccount(req, res) {
  const userId = req.user.id;

  await supabase.from('profiles').update({ is_banned: true }).eq('id', userId);
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ deleted: true });
}

async function bumpStreak(req, res) {
  const { data: profile, error: fetchError } = await supabase
    .from('profiles')
    .select('streak_count, last_streak_at')
    .eq('id', req.user.id)
    .single();

  if (fetchError) return res.status(400).json({ error: fetchError.message });

  const today = new Date().toISOString().slice(0, 10);
  const last = profile.last_streak_at ? profile.last_streak_at.slice(0, 10) : null;

  if (last === today) {
    return res.json({ streak_count: profile.streak_count, already_recorded: true });
  }

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const nextStreak = last === yesterday ? (profile.streak_count || 0) + 1 : 1;

  const { data, error } = await supabase
    .from('profiles')
    .update({
      streak_count: nextStreak,
      last_streak_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.user.id)
    .select('streak_count')
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ streak_count: data.streak_count, already_recorded: false });
}

module.exports = {
  getProfile,
  updateProfile,
  getSavings,
  getFavorites,
  toggleFavorite,
  walletHistory,
  savePushToken,
  deleteAccount,
  bumpStreak,
};
