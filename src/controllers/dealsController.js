const supabase = require('../config/supabase');
const { validationResult } = require('express-validator');

async function list(req, res) {
  const { category_id, city, search, type, page = 1, limit = 20 } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('deals_with_business')
    .select('*', { count: 'exact' })
    .eq('is_active', true)
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
    .eq('is_college_deal', true)
    .gt('end_date', new Date().toISOString())
    .limit(20);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function getById(req, res) {
  const { data, error } = await supabase
    .from('deals_with_business')
    .select('*')
    .eq('id', req.params.id)
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
    image_url, original_price,
  } = req.body;

  const { data, error } = await supabase
    .from('deals')
    .insert({
      business_id: business.id,
      title,
      description,
      discount_percentage,
      deal_type: deal_type || 'general',
      redemption_method: redemption_method || 'qr',
      terms,
      end_date,
      max_redemptions,
      is_college_deal: is_college_deal || false,
      requires_paid_tier: requires_paid_tier || false,
      image_url,
      original_price,
      is_active: true,
    })
    .select()
    .single();

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
    'max_redemptions', 'is_college_deal', 'requires_paid_tier', 'image_url', 'is_active'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
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

module.exports = { list, dealsOfWeek, collegeDeals, getById, redeem, verifyRedemption, create, update, remove };

async function verifyRedemption(req, res) {
  const { redemption_id } = req.body;
  if (!redemption_id) return res.status(400).json({ error: 'redemption_id required' });

  // Only a business owner can verify — check the caller owns a business
  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', req.user.id)
    .single();

  if (!business) return res.status(403).json({ error: 'Only business owners can verify redemptions' });

  const { data: redemption, error } = await supabase
    .from('redemptions')
    .select('id, user_id, deal_id, business_id, redeemed_at, deals(title, discount_percentage), profiles(full_name, membership_tier)')
    .eq('id', redemption_id)
    .single();

  if (error || !redemption) return res.status(404).json({ error: 'Redemption not found' });

  res.json({
    type: 'redemption',
    is_valid: true,
    already_used: false, // TODO: add verified_at column via Supabase dashboard to enable double-scan detection
    member_name: redemption.profiles?.full_name,
    membership_tier: redemption.profiles?.membership_tier,
    deal_title: redemption.deals?.title,
    discount_percentage: redemption.deals?.discount_percentage,
    redeemed_at: redemption.redeemed_at,
  });
}
