const supabase = require('../config/supabase');
const { validationResult } = require('express-validator');
const { parseEndDate } = require('../utils/parseEndDate');
const { resolveRedemptionId } = require('../utils/resolveRedemptionId');

async function list(req, res) {
  const { category_id, city, search, type, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('deals_with_business')
    .select('*', { count: 'exact' })
    .eq('is_active', true)
    .eq('business_is_approved', true)
    .gt('end_date', new Date().toISOString())
    .range(offset, offset + Number(limit) - 1);

  if (category_id) query = query.eq('category_id', category_id);
  if (city) query = query.ilike('business_city', `%${city}%`);
  if (search) query = query.ilike('title', `%${search}%`);
  if (type) query = query.eq('deal_type', type);

  const { data, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });

  res.json({ deals: data, total: count, page: Number(page), limit: Number(limit) });
}

async function dealsOfWeek(req, res) {
  const { data, error } = await supabase
    .from('deals_with_business')
    .select('*')
    .eq('is_active', true)
    .eq('business_is_approved', true)
    .eq('is_deal_of_week', true)
    .gt('end_date', new Date().toISOString())
    .limit(10);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function collegeDeals(req, res) {
  const { data, error } = await supabase
    .from('deals_with_business')
    .select('*')
    .eq('is_active', true)
    .eq('business_is_approved', true)
    .eq('is_college_deal', true)
    .gt('end_date', new Date().toISOString())
    .limit(20);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function recentDeals(req, res) {
  const { data, error } = await supabase
    .from('deals_with_business')
    .select('*')
    .eq('is_active', true)
    .eq('business_is_approved', true)
    .gt('end_date', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function popularDeals(req, res) {
  const { data, error } = await supabase
    .from('deals_with_business')
    .select('*')
    .eq('is_active', true)
    .eq('business_is_approved', true)
    .gt('end_date', new Date().toISOString())
    .order('redemption_count', { ascending: false })
    .order('discount_percentage', { ascending: false })
    .limit(15);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function eventDeals(req, res) {
  const { data, error } = await supabase
    .from('deals_with_business')
    .select('*')
    .eq('is_active', true)
    .eq('business_is_approved', true)
    .eq('deal_type', 'entertainment')
    .gt('end_date', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function getById(req, res) {
  const { data, error } = await supabase
    .from('deals_with_business')
    .select('*')
    .eq('id', req.params.id)
    .eq('business_is_approved', true)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Deal not found' });
  res.json(data);
}

async function redeem(req, res) {
  const userId = req.user.id;
  const dealId = req.params.id;

  const { data: deal, error: dealErr } = await supabase
    .from('deals_with_business')
    .select('*')
    .eq('id', dealId)
    .single();

  if (dealErr || !deal) return res.status(404).json({ error: 'Deal not found' });
  if (!deal.is_active) return res.status(400).json({ error: 'Deal is no longer active' });
  if (new Date(deal.end_date) < new Date()) return res.status(400).json({ error: 'Deal has expired' });

  if (deal.requires_paid_tier) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('membership_tier, membership_expires_at')
      .eq('id', userId)
      .single();

    const isPaid =
      profile?.membership_tier === 'paid' &&
      (!profile?.membership_expires_at || new Date(profile.membership_expires_at) > new Date());

    if (!isPaid) return res.status(403).json({ error: 'Paid membership required' });
  }

  if (deal.max_redemptions) {
    const { count } = await supabase
      .from('redemptions')
      .select('id', { count: 'exact' })
      .eq('deal_id', dealId);

    if (count >= deal.max_redemptions) {
      return res.status(400).json({ error: 'Deal redemption limit reached' });
    }
  }

  // Block re-redemption after staff has scanned the QR
  const { data: used } = await supabase
    .from('redemptions')
    .select('id, verified_at, redeemed_at')
    .eq('user_id', userId)
    .eq('deal_id', dealId)
    .not('verified_at', 'is', null)
    .order('verified_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (used) {
    return res.status(400).json({
      error: 'You already used this deal. Each member can redeem it once.',
      already_redeemed: true,
      verified_at: used.verified_at,
    });
  }

  // Return existing pending (unscanned) redemption instead of creating a duplicate
  const { data: existing } = await supabase
    .from('redemptions')
    .select()
    .eq('user_id', userId)
    .eq('deal_id', dealId)
    .is('verified_at', null)
    .order('redeemed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing) {
    return res.json({ redemption: existing, qr_data: existing.id });
  }

  const { data: redemption, error: redeemErr } = await supabase
    .from('redemptions')
    .insert({
      user_id: userId,
      deal_id: dealId,
      business_id: deal.business_id,
      savings_amount: deal.original_price ? deal.original_price * (deal.discount_percentage / 100) : null,
    })
    .select()
    .single();

  if (redeemErr) return res.status(400).json({ error: redeemErr.message });
  res.json({ redemption, qr_data: redemption.id });
}

async function create(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { data: business } = await supabase
    .from('businesses')
    .select('id, is_approved')
    .eq('owner_id', req.user.id)
    .single();

  if (!business) return res.status(403).json({ error: 'No registered business found' });
  if (!business.is_approved) return res.status(403).json({ error: 'Business not approved yet' });

  const {
    title, description, discount_percentage, deal_type, redemption_method,
    terms, end_date, max_redemptions, is_college_deal, requires_paid_tier,
    image_url, images, original_price,
  } = req.body;

  let normalizedEndDate;
  try {
    normalizedEndDate = parseEndDate(end_date);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  const gallery = Array.isArray(images)
    ? images.filter((url) => typeof url === 'string' && url.trim()).slice(0, 3)
    : [];
  const primaryImage = image_url || gallery[0] || null;

  const insertPayload = {
    business_id: business.id,
    title,
    description,
    discount_percentage,
    deal_type: deal_type || 'general',
    redemption_method: redemption_method || 'qr',
    terms,
    end_date: normalizedEndDate,
    max_redemptions,
    is_college_deal: is_college_deal || false,
    requires_paid_tier: requires_paid_tier || false,
    image_url: primaryImage,
    images: gallery.length ? gallery : primaryImage ? [primaryImage] : [],
    original_price,
    is_active: true,
  };

  let { data, error } = await supabase.from('deals').insert(insertPayload).select().single();

  if (error && /images/i.test(error.message)) {
  ({ data, error } = await supabase
    .from('deals')
    .insert({ ...insertPayload, images: undefined })
    .select()
    .single());
  }

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
}

async function update(req, res) {
  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', req.user.id)
    .single();

  if (!business) return res.status(403).json({ error: 'Unauthorized' });

  const allowed = ['title', 'description', 'discount_percentage', 'terms', 'end_date',
    'max_redemptions', 'is_college_deal', 'requires_paid_tier', 'image_url', 'images', 'is_active'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (updates.end_date !== undefined) {
    try {
      updates.end_date = parseEndDate(updates.end_date);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (Array.isArray(updates.images)) {
    updates.images = updates.images.filter((url) => typeof url === 'string' && url.trim()).slice(0, 3);
    if (!updates.image_url && updates.images[0]) updates.image_url = updates.images[0];
  }

  const { data, error } = await supabase
    .from('deals')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .eq('business_id', business.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function remove(req, res) {
  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', req.user.id)
    .single();

  if (!business) return res.status(403).json({ error: 'Unauthorized' });

  const { error } = await supabase
    .from('deals')
    .delete()
    .eq('id', req.params.id)
    .eq('business_id', business.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ deleted: true });
}

async function getMyRedemption(req, res) {
  const userId = req.user.id;
  const dealId = req.params.id;

  const { data, error } = await supabase
    .from('redemptions')
    .select('id, verified_at, redeemed_at')
    .eq('user_id', userId)
    .eq('deal_id', dealId)
    .order('redeemed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.json({ redemption: null, status: 'none' });

  if (data.verified_at) {
    return res.json({
      redemption: data,
      status: 'verified',
      verified_at: data.verified_at,
      qr_data: null,
    });
  }

  res.json({
    redemption: data,
    status: 'pending',
    qr_data: data.id,
  });
}

async function verifyRedemption(req, res) {
  const { redemption_id } = req.body;
  if (!redemption_id) return res.status(400).json({ error: 'redemption_id required' });

  const { data: business } = await supabase
    .from('businesses')
    .select('id, name')
    .eq('owner_id', req.user.id)
    .single();

  if (!business) return res.status(403).json({ error: 'Only business owners can verify redemptions' });

  let resolvedId;
  try {
    resolvedId = await resolveRedemptionId(supabase, redemption_id, business.id);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!resolvedId) return res.status(404).json({ error: 'Redemption not found' });

  const { data: redemption, error } = await supabase
    .from('redemptions')
    .select('id, user_id, deal_id, business_id, redeemed_at, verified_at, deals(title, discount_percentage), profiles(full_name, membership_tier)')
    .eq('id', resolvedId)
    .single();

  if (error || !redemption) return res.status(404).json({ error: 'Redemption not found' });

  if (redemption.business_id !== business.id) {
    return res.status(403).json({ error: 'This redemption belongs to another business' });
  }

  if (redemption.verified_at) {
    return res.json({
      type: 'redemption',
      is_valid: true,
      already_used: true,
      member_name: redemption.profiles?.full_name,
      membership_tier: redemption.profiles?.membership_tier,
      deal_title: redemption.deals?.title,
      discount_percentage: redemption.deals?.discount_percentage,
      redeemed_at: redemption.redeemed_at,
      verified_at: redemption.verified_at,
    });
  }

  const verifiedAt = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from('redemptions')
    .update({ verified_at: verifiedAt })
    .eq('id', resolvedId);

  if (updateErr) return res.status(400).json({ error: updateErr.message });

  try {
    await supabase.from('notifications').insert({
      user_id: redemption.user_id,
      title: 'Deal Redeemed Successfully',
      body: `Your "${redemption.deals?.title}" deal was verified at ${business.name}.`,
      type: 'deal',
      data: { deal_id: redemption.deal_id, business_id: business.id },
    });
  } catch (_) {}

  res.json({
    type: 'redemption',
    is_valid: true,
    already_used: false,
    member_name: redemption.profiles?.full_name,
    membership_tier: redemption.profiles?.membership_tier,
    deal_title: redemption.deals?.title,
    discount_percentage: redemption.deals?.discount_percentage,
    redeemed_at: redemption.redeemed_at,
    verified_at: verifiedAt,
  });
}

module.exports = {
  list,
  dealsOfWeek,
  collegeDeals,
  recentDeals,
  popularDeals,
  eventDeals,
  getById,
  getMyRedemption,
  redeem,
  verifyRedemption,
  create,
  update,
  remove,
};
