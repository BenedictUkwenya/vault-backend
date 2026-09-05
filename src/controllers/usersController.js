const supabase = require('../config/supabase');
const stripeService = require('../services/stripeService');
const marketsService = require('../services/marketsService');

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
  const { full_name, avatar_url, city, market_id, email_notifications, push_notifications } = req.body;
  const updates = {};
  if (full_name !== undefined) updates.full_name = full_name;
  if (avatar_url !== undefined) updates.avatar_url = avatar_url;
  if (email_notifications !== undefined) updates.email_notifications = !!email_notifications;
  if (push_notifications !== undefined) updates.push_notifications = !!push_notifications;

  if (market_id !== undefined) {
    updates.market_id = market_id || null;
    if (market_id) {
      const market = await marketsService.findMarketById(market_id);
      if (market) updates.city = market.city;
    }
  } else if (city !== undefined) {
    updates.city = city;
    const market = city ? await marketsService.findMarketByCity(city) : null;
    updates.market_id = market?.id || null;
  }

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
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).map((f) => f.businesses).filter(Boolean));
}

async function isFavorite(req, res) {
  const { businessId } = req.params;
  const { data, error } = await supabase
    .from('user_favorites')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('business_id', businessId)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ favorited: !!data });
}

async function toggleFavorite(req, res) {
  const { businessId } = req.params;
  const userId = req.user.id;

  if (!businessId) return res.status(400).json({ error: 'businessId required' });

  const { data: biz, error: bizErr } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', businessId)
    .maybeSingle();
  if (bizErr) return res.status(400).json({ error: bizErr.message });
  if (!biz) return res.status(404).json({ error: 'Business not found' });

  const { data: existing, error: findErr } = await supabase
    .from('user_favorites')
    .select('id')
    .eq('user_id', userId)
    .eq('business_id', businessId)
    .maybeSingle();

  if (findErr) return res.status(400).json({ error: findErr.message });

  if (existing) {
    const { error: delErr } = await supabase
      .from('user_favorites')
      .delete()
      .eq('user_id', userId)
      .eq('business_id', businessId);
    if (delErr) return res.status(400).json({ error: delErr.message });
    return res.json({ favorited: false });
  }

  const { error: insErr } = await supabase
    .from('user_favorites')
    .insert({ user_id: userId, business_id: businessId });
  if (insErr) return res.status(400).json({ error: insErr.message });
  res.json({ favorited: true });
}

async function getDealFavorites(req, res) {
  const { data, error } = await supabase
    .from('user_deal_favorites')
    .select('deal_id, deals(*, businesses(name, logo_url, city))')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json((data || []).map((f) => f.deals).filter(Boolean));
}

async function isDealFavorite(req, res) {
  const { dealId } = req.params;
  const { data, error } = await supabase
    .from('user_deal_favorites')
    .select('id')
    .eq('user_id', req.user.id)
    .eq('deal_id', dealId)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  res.json({ favorited: !!data });
}

async function toggleDealFavorite(req, res) {
  const { dealId } = req.params;
  const userId = req.user.id;
  if (!dealId) return res.status(400).json({ error: 'dealId required' });

  const { data: deal, error: dealErr } = await supabase
    .from('deals')
    .select('id')
    .eq('id', dealId)
    .maybeSingle();
  if (dealErr) return res.status(400).json({ error: dealErr.message });
  if (!deal) return res.status(404).json({ error: 'Deal not found' });

  const { data: existing, error: findErr } = await supabase
    .from('user_deal_favorites')
    .select('id')
    .eq('user_id', userId)
    .eq('deal_id', dealId)
    .maybeSingle();
  if (findErr) return res.status(400).json({ error: findErr.message });

  if (existing) {
    const { error: delErr } = await supabase
      .from('user_deal_favorites')
      .delete()
      .eq('user_id', userId)
      .eq('deal_id', dealId);
    if (delErr) return res.status(400).json({ error: delErr.message });
    return res.json({ favorited: false });
  }

  const { error: insErr } = await supabase
    .from('user_deal_favorites')
    .insert({ user_id: userId, deal_id: dealId });
  if (insErr) return res.status(400).json({ error: insErr.message });
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

  // A deleted account must not leave a paid membership billing in Stripe.
  const { data: subscriptions, error: subscriptionError } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', userId)
    .in('status', ['active', 'trialing', 'past_due']);

  if (subscriptionError) return res.status(400).json({ error: subscriptionError.message });

  try {
    await Promise.all(
      (subscriptions || [])
        .map((subscription) => subscription.stripe_subscription_id)
        .filter(Boolean)
        .map((subscriptionId) => stripeService.cancelSubscriptionImmediately(subscriptionId))
    );
  } catch (error) {
    return res.status(502).json({
      error: 'Unable to cancel your active membership. Please try again or contact support.',
    });
  }

  await supabase.from('profiles').update({ is_banned: true }).eq('id', userId);
  const { error } = await supabase.auth.admin.deleteUser(userId);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ deleted: true, canceled_subscriptions: subscriptions?.length ?? 0 });
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
  isFavorite,
  toggleFavorite,
  getDealFavorites,
  isDealFavorite,
  toggleDealFavorite,
  walletHistory,
  savePushToken,
  deleteAccount,
  bumpStreak,
};
