const supabase = require('../config/supabase');
const { validationResult } = require('express-validator');
const { parseEndDate } = require('../utils/parseEndDate');
const { resolveRedemptionId } = require('../utils/resolveRedemptionId');
const membership = require('../services/membershipService');
const passportService = require('../services/passportService');
const notificationService = require('../services/notificationService');

/** Unscanned QR codes stop counting (and stop verifying) after this long. */
const PENDING_QR_TTL_MS = 48 * 60 * 60 * 1000;

function qrExpiresAt(redeemedAt) {
  return new Date(new Date(redeemedAt || Date.now()).getTime() + PENDING_QR_TTL_MS).toISOString();
}

function applyCityFilter(query, city) {
  const c = String(city || '').trim().replace(/[%_\\]/g, '');
  if (!c) return query;
  return query.ilike('business_city', `%${c}%`);
}

function applyScopeFilters(query, { city, country, category_id }) {
  let q = applyCityFilter(query, city);
  const ctry = String(country || '').trim().replace(/[%_\\]/g, '');
  if (ctry) q = q.ilike('business_country', ctry);
  if (category_id) q = q.eq('category_id', category_id);
  return q;
}

async function getOwnedBusiness(userId, columns = 'id') {
  const { data } = await supabase
    .from('businesses')
    .select(columns)
    .eq('owner_id', userId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  return data || null;
}

async function list(req, res) {
  const { category_id, city, country, search, type } = req.query;
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 20));
  const offset = (page - 1) * limit;
  const sort = String(req.query.sort || 'newest');

  let query = supabase
    .from('deals_with_business')
    .select('*', { count: 'exact' })
    .eq('is_active', true)
    .eq('business_is_approved', true)
    .gt('end_date', new Date().toISOString())
    .range(offset, offset + limit - 1);

  query = applyScopeFilters(query, { city, country, category_id });
  if (search) query = query.ilike('title', `%${String(search).replace(/[%_\\]/g, '')}%`);
  if (type) query = query.eq('deal_type', type);

  if (sort === 'discount') query = query.order('discount_percentage', { ascending: false });
  else if (sort === 'ending') query = query.order('end_date', { ascending: true });
  else query = query.order('created_at', { ascending: false });

  const { data, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });

  res.json({ deals: data, total: count, page, limit });
}

async function dealsOfWeek(req, res) {
  let query = supabase
    .from('deals_with_business')
    .select('*')
    .eq('is_active', true)
    .eq('business_is_approved', true)
    .eq('is_deal_of_week', true)
    .gt('end_date', new Date().toISOString())
    .limit(10);
  query = applyScopeFilters(query, req.query);

  const { data, error } = await query;

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function dealsOfMonth(req, res) {
  // Curated “deal of the month” flags when present
  let curatedQuery = supabase
    .from('deals_with_business')
    .select('*')
    .eq('is_active', true)
    .eq('business_is_approved', true)
    .eq('is_deal_of_month', true)
    .gt('end_date', new Date().toISOString())
    .limit(10);
  curatedQuery = applyScopeFilters(curatedQuery, req.query);
  const curated = await curatedQuery;

  if (!curated.error && curated.data?.length) {
    return res.json(curated.data);
  }

  // Fallback: strongest live offers (same ranking as popular)
  let query = supabase
    .from('deals_with_business')
    .select('*')
    .eq('is_active', true)
    .eq('business_is_approved', true)
    .gt('end_date', new Date().toISOString())
    .order('redemption_count', { ascending: false })
    .order('discount_percentage', { ascending: false })
    .limit(12);
  query = applyScopeFilters(query, req.query);
  const { data, error } = await query;

  if (error) return res.status(400).json({ error: error.message });
  res.json(data || []);
}

async function collegeDeals(req, res) {
  const query = applyScopeFilters(
    supabase
      .from('deals_with_business')
      .select('*')
      .eq('is_active', true)
      .eq('business_is_approved', true)
      .eq('is_college_deal', true)
      .gt('end_date', new Date().toISOString())
      .limit(20),
    req.query
  );
  const { data, error } = await query;

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function recentDeals(req, res) {
  let query = supabase
    .from('deals_with_business')
    .select('*')
    .eq('is_active', true)
    .eq('business_is_approved', true)
    .gt('end_date', new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(20);
  query = applyScopeFilters(query, req.query);
  const { data, error } = await query;

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function popularDeals(req, res) {
  let query = supabase
    .from('deals_with_business')
    .select('*')
    .eq('is_active', true)
    .eq('business_is_approved', true)
    .gt('end_date', new Date().toISOString())
    .order('redemption_count', { ascending: false })
    .order('discount_percentage', { ascending: false })
    .limit(15);
  query = applyScopeFilters(query, req.query);
  const { data, error } = await query;

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function eventDeals(req, res) {
  const query = applyScopeFilters(
    supabase
      .from('deals_with_business')
      .select('*')
      .eq('is_active', true)
      .eq('business_is_approved', true)
      .eq('deal_type', 'entertainment')
      .gt('end_date', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(15),
    req.query
  );
  const { data, error } = await query;

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
  if (!deal.business_is_approved) return res.status(404).json({ error: 'Deal not found' });
  if (!deal.is_active) return res.status(400).json({ error: 'Deal is no longer active' });
  if (new Date(deal.end_date) < new Date()) return res.status(400).json({ error: 'Deal has expired' });
  if (deal.business_owner_id && deal.business_owner_id === userId) {
    return res.status(403).json({ error: 'You can’t redeem deals at your own business.' });
  }

  if (deal.requires_vip_tier) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('membership_tier, membership_expires_at')
      .eq('id', userId)
      .single();

    if (!membership.isVip(membership.effectiveTier(profile))) {
      return res.status(403).json({ error: 'VIP membership required for this offer' });
    }
  } else if (deal.requires_paid_tier) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('membership_tier, membership_expires_at')
      .eq('id', userId)
      .single();

    if (!membership.isMembershipActive(profile)) {
      return res.status(403).json({ error: 'Paid membership required' });
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

  // An existing unscanned QR for this deal is returned (and refreshed if stale)
  // rather than creating a second row.
  const { data: existing } = await supabase
    .from('redemptions')
    .select()
    .eq('user_id', userId)
    .eq('deal_id', dealId)
    .is('verified_at', null)
    .order('redeemed_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  const pendingCutoff = new Date(Date.now() - PENDING_QR_TTL_MS).toISOString();

  if (existing && existing.redeemed_at >= pendingCutoff) {
    return res.json({ redemption: existing, qr_data: existing.id, expires_at: qrExpiresAt(existing.redeemed_at) });
  }

  // Monthly cap by tier. Outstanding QR codes count too, otherwise a free member
  // could generate one per deal and have them all scanned.
  {
    const { data: profile } = await supabase
      .from('profiles')
      .select('membership_tier, membership_expires_at')
      .eq('id', userId)
      .single();

    const tier = membership.effectiveTier(profile);
    const limit = membership.redemptionLimitForTier(tier);
    if (limit != null) {
      const { start, end } = membership.monthWindow();
      const [verifiedRes, pendingRes] = await Promise.all([
        supabase
          .from('redemptions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .gte('verified_at', start)
          .lt('verified_at', end),
        supabase
          .from('redemptions')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .is('verified_at', null)
          .gte('redeemed_at', pendingCutoff),
      ]);
      const count = (verifiedRes.count || 0) + (pendingRes.count || 0);

      if (count >= limit) {
        const passportService = require('../services/passportService');
        let credits = 0;
        try {
          credits = await passportService.getRedemptionCredits(userId);
        } catch (_) {
          credits = 0;
        }
        if (credits > 0) {
          req._passportConsumeCredit = true;
        } else {
          return res.status(403).json({
            error: `Monthly redemption limit reached (${limit} for ${tier} plan). Upgrade for more, or claim a Passport bonus credit.`,
            redemptions_used: count || 0,
            redemptions_limit: limit,
            tier,
          });
        }
      }
    }
  }

  if (deal.max_redemptions) {
    const [verifiedRes, pendingRes] = await Promise.all([
      supabase
        .from('redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('deal_id', dealId)
        .not('verified_at', 'is', null),
      supabase
        .from('redemptions')
        .select('id', { count: 'exact', head: true })
        .eq('deal_id', dealId)
        .is('verified_at', null)
        .gte('redeemed_at', pendingCutoff),
    ]);
    if ((verifiedRes.count || 0) + (pendingRes.count || 0) >= deal.max_redemptions) {
      return res.status(400).json({ error: 'Deal redemption limit reached' });
    }
  }

  const savingsAmount = deal.original_price
    ? Number(deal.original_price) * (deal.discount_percentage / 100)
    : null;
  let redemption;
  let redeemErr;

  if (existing) {
    // Stale unscanned QR: refresh it instead of inserting (one row per member per deal).
    ({ data: redemption, error: redeemErr } = await supabase
      .from('redemptions')
      .update({ redeemed_at: new Date().toISOString(), savings_amount: savingsAmount })
      .eq('id', existing.id)
      .is('verified_at', null)
      .select()
      .single());
  } else {
    ({ data: redemption, error: redeemErr } = await supabase
      .from('redemptions')
      .insert({
        user_id: userId,
        deal_id: dealId,
        business_id: deal.business_id,
        savings_amount: savingsAmount,
      })
      .select()
      .single());

    if (redeemErr?.code === '23505') {
      // Double tap raced us; hand back the row the other request created.
      const { data: raced } = await supabase
        .from('redemptions')
        .select()
        .eq('user_id', userId)
        .eq('deal_id', dealId)
        .limit(1)
        .maybeSingle();
      if (raced) return res.json({ redemption: raced, qr_data: raced.id, expires_at: qrExpiresAt(raced.redeemed_at) });
    }
  }

  if (redeemErr || !redemption) {
    return res.status(400).json({ error: redeemErr?.message || 'Could not create redemption' });
  }

  if (req._passportConsumeCredit) {
    try {
      const passportService = require('../services/passportService');
      await passportService.consumeRedemptionCredit(userId);
    } catch (_) {
      /* non-fatal — redemption already created */
    }
  }

  res.json({ redemption, qr_data: redemption.id, expires_at: qrExpiresAt(redemption.redeemed_at) });
}

async function create(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const business = await getOwnedBusiness(req.user.id, 'id, is_approved, review_status, timezone');

  if (!business) return res.status(403).json({ error: 'No registered business found' });
  // Pending businesses can prepare deals; they stay hidden until the business is approved.
  if (['rejected', 'suspended'].includes(business.review_status)) {
    return res.status(403).json({
      error: 'Your business needs changes before you can add deals. Update your profile to resubmit.',
    });
  }

  const {
    title, description, discount_percentage, deal_type, redemption_method,
    terms, end_date, max_redemptions, is_college_deal, requires_paid_tier,
    image_url, images, original_price,
  } = req.body;

  let normalizedEndDate;
  try {
    normalizedEndDate = parseEndDate(end_date, business.timezone);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  if (new Date(normalizedEndDate) <= new Date()) {
    return res.status(400).json({ error: 'End date must be in the future.' });
  }
  const priceNum = original_price === undefined || original_price === null || original_price === ''
    ? null
    : Number(original_price);
  if (priceNum !== null && (!Number.isFinite(priceNum) || priceNum < 0)) {
    return res.status(400).json({ error: 'Typical price must be a positive number.' });
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
    original_price: priceNum,
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

async function getMine(req, res) {
  const business = await getOwnedBusiness(req.user.id);
  if (!business) return res.status(403).json({ error: 'Unauthorized' });

  const { data, error } = await supabase
    .from('deals')
    .select('*')
    .eq('id', req.params.id)
    .eq('business_id', business.id)
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Deal not found' });
  res.json(data);
}

async function update(req, res) {
  const business = await getOwnedBusiness(req.user.id, 'id, timezone');
  if (!business) return res.status(403).json({ error: 'Unauthorized' });

  const { data: current } = await supabase
    .from('deals')
    .select('id, admin_suspended_at, admin_suspended_reason')
    .eq('id', req.params.id)
    .eq('business_id', business.id)
    .maybeSingle();
  if (!current) return res.status(404).json({ error: 'Deal not found' });

  const allowed = ['title', 'description', 'discount_percentage', 'terms', 'end_date', 'original_price',
    'max_redemptions', 'is_college_deal', 'requires_paid_tier', 'image_url', 'images', 'is_active'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (updates.is_active === true && current.admin_suspended_at) {
    return res.status(403).json({
      error: `This deal was paused by Black Limitless${current.admin_suspended_reason ? `: ${current.admin_suspended_reason}` : ''}. Contact support to reactivate it.`,
    });
  }

  if (updates.discount_percentage !== undefined) {
    const pct = Number(updates.discount_percentage);
    if (!Number.isInteger(pct) || pct < 25 || pct > 100) {
      return res.status(422).json({ error: 'Discount must be a whole number from 25 to 100.' });
    }
    updates.discount_percentage = pct;
  }

  if (updates.original_price !== undefined) {
    if (updates.original_price === null || updates.original_price === '') {
      updates.original_price = null;
    } else {
      const price = Number(updates.original_price);
      if (!Number.isFinite(price) || price < 0) {
        return res.status(422).json({ error: 'Typical price must be a positive number.' });
      }
      updates.original_price = price;
    }
  }

  if (updates.end_date !== undefined) {
    try {
      updates.end_date = parseEndDate(updates.end_date, business.timezone);
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
    if (new Date(updates.end_date) <= new Date()) {
      return res.status(400).json({ error: 'End date must be in the future.' });
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

/** Deals members already redeemed are deactivated, not deleted, to keep their history. */
async function remove(req, res) {
  const business = await getOwnedBusiness(req.user.id);
  if (!business) return res.status(403).json({ error: 'Unauthorized' });

  const { count } = await supabase
    .from('redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('deal_id', req.params.id)
    .eq('business_id', business.id);

  if ((count || 0) > 0) {
    const { error } = await supabase
      .from('deals')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .eq('business_id', business.id);
    if (error) return res.status(400).json({ error: error.message });
    return res.json({ deleted: false, deactivated: true });
  }

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

  if (new Date(data.redeemed_at).getTime() < Date.now() - PENDING_QR_TTL_MS) {
    return res.json({ redemption: data, status: 'expired', qr_data: null });
  }

  res.json({
    redemption: data,
    status: 'pending',
    qr_data: data.id,
    expires_at: new Date(new Date(data.redeemed_at).getTime() + PENDING_QR_TTL_MS).toISOString(),
  });
}

async function verifyRedemption(req, res) {
  const { redemption_id } = req.body;
  if (!redemption_id) return res.status(400).json({ error: 'redemption_id required' });

  const business = await getOwnedBusiness(req.user.id, 'id, name, is_approved');

  if (!business) return res.status(403).json({ error: 'Only business owners can verify redemptions' });
  if (!business.is_approved) {
    return res.status(403).json({ error: 'Your business must be approved before verifying redemptions' });
  }

  let resolvedId;
  try {
    resolvedId = await resolveRedemptionId(supabase, redemption_id, business.id);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }
  if (!resolvedId) return res.status(404).json({ error: 'Redemption not found' });

  const { data: redemption, error } = await supabase
    .from('redemptions')
    .select('id, user_id, deal_id, business_id, redeemed_at, verified_at, deals(title, discount_percentage, is_active, end_date), profiles(full_name, membership_tier, avatar_url)')
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

  if (redemption.user_id === req.user.id) {
    return res.status(403).json({ error: 'You can’t verify your own redemption.' });
  }
  if (new Date(redemption.redeemed_at).getTime() < Date.now() - PENDING_QR_TTL_MS) {
    return res.status(400).json({
      error: 'This QR code expired. Ask the member to open the deal and generate a new one.',
    });
  }
  if (redemption.deals && redemption.deals.is_active === false) {
    return res.status(400).json({ error: 'This deal is no longer active.' });
  }

  const verifiedAt = new Date().toISOString();
  // Conditional on still-unverified so two simultaneous scans can't both succeed.
  const { data: claimed, error: updateErr } = await supabase
    .from('redemptions')
    .update({ verified_at: verifiedAt })
    .eq('id', resolvedId)
    .is('verified_at', null)
    .select('id');

  if (updateErr) return res.status(400).json({ error: updateErr.message });
  if (!claimed?.length) {
    return res.json({
      type: 'redemption',
      is_valid: true,
      already_used: true,
      member_name: redemption.profiles?.full_name,
      membership_tier: redemption.profiles?.membership_tier,
      deal_title: redemption.deals?.title,
      discount_percentage: redemption.deals?.discount_percentage,
      redeemed_at: redemption.redeemed_at,
    });
  }

  try {
    await passportService.addStamp(redemption.user_id);
  } catch (stampErr) {
    console.error('[passport] addStamp failed after verify:', stampErr?.message || stampErr);
  }

  try {
    const referralService = require('../services/referralService');
    await referralService.recordReferralEvent(redemption.user_id, 'deal');
  } catch (_) {}

  try {
    await notificationService.createNotification({
      userId: redemption.user_id,
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
    member_avatar_url: redemption.profiles?.avatar_url || null,
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
  dealsOfMonth,
  collegeDeals,
  recentDeals,
  popularDeals,
  eventDeals,
  getById,
  getMine,
  getMyRedemption,
  redeem,
  verifyRedemption,
  create,
  update,
  remove,
};
