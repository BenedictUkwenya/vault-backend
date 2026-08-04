const supabase = require('../config/supabase');
const { ensureBusinessRole } = require('../utils/ensureBusinessRole');
const membership = require('../services/membershipService');

async function listCategories(req, res) {
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, icon, color')
    .order('sort_order');
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function scanMember(req, res) {
  const { user_id } = req.body;
  if (!user_id) return res.status(400).json({ error: 'user_id required' });

  const { data: profile, error } = await supabase
    .from('profiles')
    .select('id, full_name, membership_tier, membership_expires_at, referral_code, avatar_url')
    .eq('id', user_id)
    .single();

  if (error || !profile) return res.status(404).json({ error: 'Member not found' });

  const isValid =
    membership.isMembershipActive(profile) || profile.membership_tier === 'free';

  // Look up the scanning business name for the notification
  const { data: business } = await supabase
    .from('businesses')
    .select('name')
    .eq('owner_id', req.user.id)
    .single();

  const businessName = business?.name || 'a business';

  // Notify the scanned member their card was checked
  try {
    await supabase.from('notifications').insert({
      user_id: profile.id,
      title: 'Membership Card Scanned 🔍',
      body: `Your Black Limitless membership card was scanned at ${businessName}.`,
      type: 'system',
      data: { scanned_by_business: businessName },
    });
  } catch (_) {}

  res.json({
    id: profile.id,
    full_name: profile.full_name,
    membership_tier: membership.normalizeTier(profile.membership_tier),
    membership_expires_at: profile.membership_expires_at,
    referral_code: profile.referral_code,
    avatar_url: profile.avatar_url,
    is_valid: isValid,
    is_paid: membership.isMembershipActive(profile),
  });
}

async function list(req, res) {
  const { category_id, city, search, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('businesses_with_stats')
    .select('*', { count: 'exact' })
    .eq('is_approved', true)
    .range(offset, offset + Number(limit) - 1);

  if (category_id) query = query.eq('category_id', category_id);
  if (city) query = query.ilike('city', `%${city}%`);
  if (search) query = query.ilike('name', `%${search}%`);

  const { data, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });

  res.json({ businesses: data, total: count, page: Number(page), limit: Number(limit) });
}

async function trending(req, res) {
  const { data, error } = await supabase
    .from('businesses_with_stats')
    .select('*')
    .eq('is_approved', true)
    .order('is_featured', { ascending: false })
    .order('view_count', { ascending: false })
    .limit(10);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function getById(req, res) {
  const { id } = req.params;
  const { data, error } = await supabase
    .from('businesses_with_stats')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Business not found' });

  // Views are recorded separately on screen focus (POST /:id/view)
  res.json(data);
}

async function recordView(req, res) {
  const { id } = req.params;
  const { data: exists, error: findError } = await supabase
    .from('businesses')
    .select('id')
    .eq('id', id)
    .maybeSingle();

  if (findError || !exists) return res.status(404).json({ error: 'Business not found' });

  const { data: views, error } = await supabase.rpc('increment_business_views', {
    p_business_id: id,
  });

  if (error) {
    // Fallback for DBs still using old param name `business_id`
    const retry = await supabase.rpc('increment_business_views', { business_id: id });
    if (retry.error) return res.status(400).json({ error: retry.error.message });
    return res.json({ views: retry.data ?? null });
  }

  res.json({ views: views ?? null });
}

async function rateBusiness(req, res) {
  const { id } = req.params;
  const rating = Number(req.body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return res.status(400).json({ error: 'Rating must be an integer from 1 to 5' });
  }

  const { data: existing } = await supabase
    .from('business_ratings')
    .select('id')
    .eq('business_id', id)
    .eq('user_id', req.user.id)
    .maybeSingle();

  let error;
  if (existing?.id) {
    ({ error } = await supabase
      .from('business_ratings')
      .update({ rating, updated_at: new Date().toISOString() })
      .eq('id', existing.id));
  } else {
    ({ error } = await supabase.from('business_ratings').insert({
      business_id: id,
      user_id: req.user.id,
      rating,
    }));
  }

  if (error) return res.status(400).json({ error: error.message });

  await supabase.rpc('refresh_business_rating_avg', { p_business_id: id });

  const { data: business } = await supabase
    .from('businesses_with_stats')
    .select('id, rating_avg, total_views, name')
    .eq('id', id)
    .single();

  const { data: mine } = await supabase
    .from('business_ratings')
    .select('rating')
    .eq('business_id', id)
    .eq('user_id', req.user.id)
    .maybeSingle();

  res.json({
    rating_avg: business?.rating_avg ?? 0,
    my_rating: mine?.rating ?? rating,
  });
}

async function myBusinessRating(req, res) {
  const { id } = req.params;
  const { data } = await supabase
    .from('business_ratings')
    .select('rating')
    .eq('business_id', id)
    .eq('user_id', req.user.id)
    .maybeSingle();

  res.json({ my_rating: data?.rating ?? null });
}

async function register(req, res) {
  const existing = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', req.user.id)
    .single();

  if (existing.data) {
    return res.status(409).json({ error: 'You already have a registered business' });
  }

  const { name, category_id, city, address, state, phone, website, description, latitude, longitude } = req.body;

  const { data, error } = await supabase
    .from('businesses')
    .insert({
      owner_id: req.user.id,
      name,
      category_id,
      city,
      address,
      state: state || null,
      phone,
      website,
      description,
      latitude: latitude != null ? Number(latitude) : null,
      longitude: longitude != null ? Number(longitude) : null,
      is_approved: false,
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  await ensureBusinessRole(req.user.id);

  res.status(201).json(data);
}

async function getMy(req, res) {
  const { data, error } = await supabase
    .from('businesses_with_stats')
    .select('*')
    .eq('owner_id', req.user.id)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Business not found' });

  await ensureBusinessRole(req.user.id);

  res.json(data);
}

async function updateMy(req, res) {
  const allowed = [
    'name',
    'description',
    'address',
    'city',
    'state',
    'phone',
    'website',
    'logo_url',
    'cover_url',
    'latitude',
    'longitude',
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (updates.latitude !== undefined && updates.latitude !== null) {
    updates.latitude = Number(updates.latitude);
  }
  if (updates.longitude !== undefined && updates.longitude !== null) {
    updates.longitude = Number(updates.longitude);
  }

  const { data, error } = await supabase
    .from('businesses')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('owner_id', req.user.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function getAnalytics(req, res) {
  const { data: business } = await supabase
    .from('businesses')
    .select('id, rating_avg')
    .eq('owner_id', req.user.id)
    .single();

  if (!business) return res.status(404).json({ error: 'Business not found' });

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  const [redemptions7d, redemptions30d, bookings30d, views] = await Promise.all([
    supabase
      .from('redemptions')
      .select('redeemed_at')
      .eq('business_id', business.id)
      .gte('redeemed_at', sevenDaysAgo),
    supabase
      .from('redemptions')
      .select('redeemed_at')
      .eq('business_id', business.id)
      .gte('redeemed_at', thirtyDaysAgo),
    supabase
      .from('bookings')
      .select('created_at, status')
      .eq('business_id', business.id)
      .gte('created_at', thirtyDaysAgo),
    supabase
      .from('businesses_with_stats')
      .select('total_views')
      .eq('id', business.id)
      .single(),
  ]);

  // Build a 7-element array: index 0 = 6 days ago ... index 6 = today
  const dailyCounts = Array(7).fill(0);
  const now = new Date();
  for (const row of (redemptions7d.data || [])) {
    const daysAgo = Math.floor((now - new Date(row.redeemed_at)) / (24 * 60 * 60 * 1000));
    const idx = 6 - daysAgo;
    if (idx >= 0 && idx < 7) dailyCounts[idx]++;
  }

  res.json({
    redemptions_30d: redemptions30d.data?.length || 0,
    bookings_30d: bookings30d.data?.length || 0,
    total_views: views.data?.total_views || 0,
    rating: business.rating_avg || 0,
    redemptions_7d: dailyCounts,
  });
}

async function vote(req, res) {
  const { id } = req.params;

  const { data: existing } = await supabase
    .from('business_votes')
    .select('id')
    .eq('business_id', id)
    .eq('user_id', req.user.id)
    .gte('created_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString())
    .single();

  if (existing) {
    return res.status(409).json({ error: 'You already voted this month' });
  }

  const { error } = await supabase
    .from('business_votes')
    .insert({ business_id: id, user_id: req.user.id });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ voted: true });
}

async function voteResults(req, res) {
  const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { data, error } = await supabase
    .from('business_votes')
    .select('business_id, businesses(name, logo_url, is_founding_member, founding_member_number)')
    .gte('created_at', start);

  if (error) return res.status(400).json({ error: error.message });

  const counts = {};
  for (const row of data || []) {
    if (!counts[row.business_id]) {
      counts[row.business_id] = { business_id: row.business_id, ...row.businesses, votes: 0 };
    }
    counts[row.business_id].votes++;
  }

  const results = Object.values(counts).sort((a, b) => b.votes - a.votes).slice(0, 10);
  res.json(results);
}

async function myVote(req, res) {
  const start = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
  const { data } = await supabase
    .from('business_votes')
    .select('business_id, created_at, businesses(name, logo_url, is_founding_member, founding_member_number)')
    .eq('user_id', req.user.id)
    .gte('created_at', start)
    .maybeSingle();

  res.json({ voted: !!data, vote: data || null });
}

async function foundingWall(req, res) {
  const { data, error } = await supabase
    .from('businesses')
    .select(
      'id, name, logo_url, cover_url, city, state, category_id, is_founding_member, founding_member_number, description'
    )
    .eq('is_approved', true)
    .eq('is_founding_member', true)
    .order('founding_member_number', { ascending: true })
    .limit(100);

  if (error) return res.status(400).json({ error: error.message });

  res.json({
    title: 'Founding Business Wall',
    subtitle:
      'The first 100 businesses to join Black Limitless — permanent recognition as original partners who helped launch the platform.',
    businesses: data || [],
    total: (data || []).length,
    capacity: 100,
  });
}

module.exports = {
  listCategories,
  scanMember,
  list,
  trending,
  getById,
  recordView,
  rateBusiness,
  myBusinessRating,
  register,
  getMy,
  updateMy,
  getAnalytics,
  vote,
  voteResults,
  myVote,
  foundingWall,
};
