const supabase = require('../config/supabase');
const logger = require('../config/logger');
const { ensureBusinessRole } = require('../utils/ensureBusinessRole');
const notificationService = require('../services/notificationService');
const { logAdminAction } = require('../utils/adminAudit');
const { syncEffectiveTier } = require('../services/tierSync');

const ROLES = ['user', 'business', 'ambassador', 'admin', 'super_admin'];
const ADMIN_ROLES = ['admin', 'super_admin'];
const TIERS = ['free', 'student', 'member', 'vip'];

function pageParams(query, defaultLimit = 50) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

/** Strip characters that would break or extend a PostgREST `.or()` filter. */
function safeSearchTerm(value) {
  return String(value || '')
    .replace(/[,()%*\\]/g, ' ')
    .trim()
    .slice(0, 80);
}

async function stats(req, res) {
  const [users, businesses, deals, activeSubscriptions] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('businesses').select('id', { count: 'exact', head: true }),
    supabase
      .from('deals')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true)
      .gt('end_date', new Date().toISOString()),
    supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  ]);

  res.json({
    total_users: users.count || 0,
    total_businesses: businesses.count || 0,
    active_deals: deals.count || 0,
    active_subscriptions: activeSubscriptions.count || 0,
  });
}

const ANALYTICS_RANGES = new Set([7, 30, 90]);

/** Product analytics overview — wraps admin_analytics_overview RPC for mobile + API clients. */
async function analyticsOverview(req, res) {
  const requested = parseInt(req.query.range, 10);
  const days = ANALYTICS_RANGES.has(requested) ? requested : 30;
  const windowMs = days * 24 * 60 * 60 * 1000;
  const to = new Date();
  const from = new Date(to.getTime() - windowMs);
  const prevFrom = new Date(from.getTime() - windowMs);

  const [current, previous, platform] = await Promise.all([
    supabase.rpc('admin_analytics_overview', { p_from: from.toISOString(), p_to: to.toISOString() }),
    supabase.rpc('admin_analytics_overview', { p_from: prevFrom.toISOString(), p_to: from.toISOString() }),
    platformTotals(),
  ]);

  if (current.error) {
    logger.error('admin analytics overview failed', { error: current.error.message });
    return res.status(503).json({
      error: 'Analytics unavailable',
      detail: current.error.message,
      hint: 'Apply vault-backend/supabase/migrations/036_analytics_dashboard.sql',
    });
  }

  const data = current.data && typeof current.data === 'object' ? current.data : { kpis: null };
  res.json({
    range_days: days,
    from: from.toISOString(),
    to: to.toISOString(),
    ...data,
    previous_kpis: previous.error ? null : previous.data?.kpis ?? null,
    platform,
  });
}

async function platformTotals() {
  const count = (query) => query.then((r) => r.count || 0);
  const profiles = () => supabase.from('profiles').select('id', { count: 'exact', head: true });
  const businesses = () => supabase.from('businesses').select('id', { count: 'exact', head: true });
  const statuses = ['approved', 'pending', 'rejected', 'suspended'];

  const [totalUsers, tierCounts, totalBusinesses, statusCounts, liveDeals, subscribers] = await Promise.all([
    count(profiles()),
    Promise.all(TIERS.map((tier) => count(profiles().eq('membership_tier', tier)))),
    count(businesses()),
    Promise.all(statuses.map((status) => count(businesses().eq('review_status', status)))),
    count(
      supabase
        .from('deals')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true)
        .gt('end_date', new Date().toISOString())
    ),
    count(supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active')),
  ]);

  return {
    total_users: totalUsers,
    users_by_tier: TIERS.map((tier, i) => ({ tier, count: tierCounts[i] })),
    total_businesses: totalBusinesses,
    businesses_by_status: statuses.map((status, i) => ({ status, count: statusCounts[i] })),
    live_deals: liveDeals,
    active_subscriptions: subscribers,
  };
}

async function listUsers(req, res) {
  const { search, role, tier, banned } = req.query;
  const { limit, offset } = pageParams(req.query);

  let query = supabase
    .from('profiles')
    .select('*', { count: 'exact' })
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false });

  const q = safeSearchTerm(search);
  if (q) {
    query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%,phone.ilike.%${q}%,referral_code.ilike.%${q}%`);
  }
  if (role && role !== 'all') query = query.eq('role', role);
  if (tier && tier !== 'all') query = query.eq('membership_tier', tier);
  if (banned === 'true') query = query.eq('is_banned', true);
  else if (banned === 'false') query = query.eq('is_banned', false);

  const { data, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });

  res.json({ users: data, total: count });
}

async function getUser(req, res) {
  const { id } = req.params;
  const { data: user, error } = await supabase.from('profiles').select('*').eq('id', id).single();
  if (error || !user) return res.status(404).json({ error: 'User not found' });

  const [bookings, redemptions, business] = await Promise.all([
    supabase.from('bookings').select('id', { count: 'exact', head: true }).eq('user_id', id),
    supabase.from('redemptions').select('id', { count: 'exact', head: true }).eq('user_id', id),
    supabase
      .from('businesses')
      .select('id, name, is_approved, review_status, city')
      .eq('owner_id', id)
      .order('created_at', { ascending: false })
      .limit(1),
  ]);

  res.json({
    ...user,
    bookings_count: bookings.count || 0,
    redemptions_count: redemptions.count || 0,
    business: business.data?.[0] || null,
  });
}

async function updateUser(req, res) {
  const { id } = req.params;
  const allowed = [
    'role',
    'membership_tier',
    'membership_expires_at',
    'is_banned',
    'full_name',
    'city',
    'avatar_url',
    'streak_count',
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (updates.role !== undefined && !ROLES.includes(updates.role)) {
    return res.status(422).json({ error: 'Invalid role' });
  }
  if (updates.membership_tier !== undefined && !TIERS.includes(updates.membership_tier)) {
    return res.status(422).json({ error: 'Invalid membership tier' });
  }
  if (updates.membership_expires_at !== undefined && updates.membership_expires_at !== null) {
    if (Number.isNaN(Date.parse(updates.membership_expires_at))) {
      return res.status(422).json({ error: 'Invalid membership_expires_at' });
    }
  }
  if (updates.streak_count !== undefined) {
    const n = Number(updates.streak_count);
    if (!Number.isInteger(n) || n < 0) return res.status(422).json({ error: 'Invalid streak_count' });
  }
  if (updates.is_banned !== undefined) updates.is_banned = !!updates.is_banned;

  const { data: target } = await supabase
    .from('profiles')
    .select('id, role, membership_tier, membership_expires_at, is_banned')
    .eq('id', id)
    .maybeSingle();
  if (!target) return res.status(404).json({ error: 'User not found' });

  const actorIsSuper = req.profile?.role === 'super_admin';
  const touchesAccess = updates.role !== undefined || updates.is_banned !== undefined;

  if (id === req.user.id && touchesAccess) {
    return res.status(400).json({ error: 'You cannot change your own role or ban status.' });
  }
  if (target.role === 'super_admin' && !actorIsSuper) {
    return res.status(403).json({ error: 'Only a super admin can modify a super admin.' });
  }
  if (
    updates.role !== undefined &&
    updates.role !== target.role &&
    (ADMIN_ROLES.includes(updates.role) || ADMIN_ROLES.includes(target.role)) &&
    !actorIsSuper
  ) {
    return res.status(403).json({ error: 'Only a super admin can grant or remove admin access.' });
  }

  // Admin plan changes are complimentary grants, recomputed alongside Stripe so the
  // next renewal webhook doesn't overwrite them. "Free" removes the grant only;
  // an active Stripe subscription still applies until it's cancelled in Stripe.
  const tierChanged = updates.membership_tier !== undefined || updates.membership_expires_at !== undefined;
  if (tierChanged) {
    const compTier = updates.membership_tier ?? target.membership_tier;
    updates.comp_tier = compTier === 'free' ? null : compTier;
    updates.comp_expires_at =
      compTier === 'free'
        ? null
        : updates.membership_expires_at !== undefined
          ? updates.membership_expires_at
          : target.membership_expires_at;
    updates.comp_granted_by = compTier === 'free' ? null : req.user.id;
    updates.comp_reason = compTier === 'free' ? null : 'admin_grant';
    delete updates.membership_tier;
    delete updates.membership_expires_at;
  }

  let { data, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (tierChanged) {
    try {
      await syncEffectiveTier(id);
      ({ data } = await supabase.from('profiles').select('*').eq('id', id).single());
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }
  }

  if (updates.is_banned === true && !target.is_banned) {
    await supabase.from('profiles').update({ push_token: null }).eq('id', id);
  }

  await logAdminAction(req, {
    action: 'user.update',
    targetType: 'user',
    targetId: id,
    before: target,
    after: updates,
  });
  res.json(data);
}

async function notifyUser(req, res) {
  const { id } = req.params;
  const { title, body, type = 'system' } = req.body;
  if (!title || !body) return res.status(422).json({ error: 'title and body required' });

  try {
    await notificationService.createNotification({
      userId: id,
      title,
      body,
      type,
    });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
  res.json({ sent: true });
}

async function listBusinesses(req, res) {
  const { status } = req.query;
  const { limit, offset } = pageParams(req.query);

  let query = supabase
    .from('businesses_with_stats')
    .select('*', { count: 'exact' })
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false });

  if (['pending', 'approved', 'rejected', 'suspended'].includes(status)) {
    query = query.eq('review_status', status);
  }

  const { data, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });

  res.json({ businesses: data, total: count });
}

async function approveBusiness(req, res) {
  const { data: existing, error: fetchError } = await supabase
    .from('businesses')
    .select('id, owner_id, is_founding_member, founding_member_number, is_approved')
    .eq('id', req.params.id)
    .single();

  if (fetchError) return res.status(400).json({ error: fetchError.message });
  if (!existing) return res.status(404).json({ error: 'Business not found' });

  const now = new Date().toISOString();
  const patch = {
    is_approved: true,
    review_status: 'approved',
    rejection_reason: null,
    reviewed_at: now,
    reviewed_by: req.user.id,
    updated_at: now,
  };

  // First 100 approved partners get Founding Member status. Use the smallest free
  // number so backfill gaps don't collide with the unique index and fail approval.
  if (!existing.is_founding_member) {
    const { data: taken } = await supabase
      .from('businesses')
      .select('founding_member_number')
      .eq('is_founding_member', true)
      .not('founding_member_number', 'is', null);
    const used = new Set((taken || []).map((r) => r.founding_member_number));
    let next = null;
    for (let n = 1; n <= 100; n += 1) {
      if (!used.has(n)) {
        next = n;
        break;
      }
    }
    if (next) {
      patch.is_founding_member = true;
      patch.founding_member_number = next;
    }
  }

  let { data, error } = await supabase
    .from('businesses')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error && error.code === '23505' && patch.founding_member_number) {
    // Lost a race for the number; approve without founding status rather than failing.
    delete patch.is_founding_member;
    delete patch.founding_member_number;
    ({ data, error } = await supabase
      .from('businesses')
      .update(patch)
      .eq('id', req.params.id)
      .select()
      .single());
  }

  if (error) {
    logger.error('approveBusiness failed', { id: req.params.id, error: error.message, patch });
    return res.status(400).json({ error: error.message });
  }

  if (data?.owner_id) {
    await ensureBusinessRole(data.owner_id);
    await notificationService
      .createNotification({
        userId: data.owner_id,
        title: `${data.name} is live 🎉`,
        body: 'Your business was approved. Members can now see it and your deals.',
        type: 'system',
        data: { kind: 'business_approved', business_id: data.id },
      })
      .catch(() => null);
  }

  await logAdminAction(req, {
    action: 'business.approve',
    targetType: 'business',
    targetId: data.id,
    before: { is_approved: existing.is_approved },
    after: { is_approved: true, founding_member_number: data.founding_member_number },
  });
  res.json(data);
}

async function rejectBusiness(req, res) {
  const reason = String(req.body.reason || '').trim().slice(0, 500) || 'Does not meet our partner guidelines';

  const { data: existing } = await supabase
    .from('businesses')
    .select('id, owner_id, name, is_approved, review_status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Business not found' });

  // Revoking a live business is a suspension; rejecting an application is a rejection.
  const nextStatus = existing.is_approved ? 'suspended' : 'rejected';
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('businesses')
    .update({
      is_approved: false,
      is_featured: false,
      review_status: nextStatus,
      rejection_reason: reason,
      reviewed_at: now,
      reviewed_by: req.user.id,
      updated_at: now,
    })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  if (existing.owner_id) {
    await notificationService
      .createNotification({
        userId: existing.owner_id,
        title: nextStatus === 'suspended' ? `${existing.name} was paused` : `Update on ${existing.name}`,
        body: `Reason: ${reason}. Update your profile and resubmit from the business portal.`,
        type: 'system',
        data: { kind: `business_${nextStatus}`, business_id: existing.id },
      })
      .catch(() => null);
  }

  await logAdminAction(req, {
    action: `business.${nextStatus === 'suspended' ? 'suspend' : 'reject'}`,
    targetType: 'business',
    targetId: existing.id,
    before: { review_status: existing.review_status },
    after: { review_status: nextStatus, reason },
  });
  res.json(data);
}

async function listDeals(req, res) {
  const { status } = req.query;
  const { limit, offset } = pageParams(req.query);
  const nowIso = new Date().toISOString();

  let query = supabase
    .from('deals_with_business')
    .select('*', { count: 'exact' })
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false });

  if (status === 'live') query = query.eq('is_active', true).gt('end_date', nowIso);
  else if (status === 'inactive') query = query.eq('is_active', false);
  else if (status === 'expired') query = query.lte('end_date', nowIso);
  else if (status === 'suspended') query = query.not('admin_suspended_at', 'is', null);

  const { data, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ deals: data, total: count });
}

async function approveDeal(req, res) {
  const { data, error } = await supabase
    .from('deals')
    .update({
      is_active: true,
      admin_suspended_at: null,
      admin_suspended_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Deal not found' });
  await logAdminAction(req, { action: 'deal.approve', targetType: 'deal', targetId: data.id });
  res.json(data);
}

/**
 * Deals with redemptions are archived (deactivated + suspended) instead of deleted,
 * because the FK cascade would erase every member's redemption history for them.
 */
async function deleteDeal(req, res) {
  const { count } = await supabase
    .from('redemptions')
    .select('id', { count: 'exact', head: true })
    .eq('deal_id', req.params.id);

  if ((count || 0) > 0) {
    const now = new Date().toISOString();
    const { error } = await supabase
      .from('deals')
      .update({
        is_active: false,
        admin_suspended_at: now,
        admin_suspended_reason: 'Removed by admin',
        updated_at: now,
      })
      .eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    await logAdminAction(req, { action: 'deal.archive', targetType: 'deal', targetId: req.params.id });
    return res.json({ deleted: false, archived: true });
  }

  const { error } = await supabase.from('deals').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  await logAdminAction(req, { action: 'deal.delete', targetType: 'deal', targetId: req.params.id });
  res.json({ deleted: true });
}

async function listSubscriptions(req, res) {
  const { limit, offset } = pageParams(req.query);

  const { data, error, count } = await supabase
    .from('subscriptions')
    .select('*, profiles(full_name, email)', { count: 'exact' })
    .range(offset, offset + limit - 1)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({
    subscriptions: (data || []).map((s) => ({ ...s, plan: s.plan || s.subscription_type || null })),
    total: count,
  });
}

async function rejectDeal(req, res) {
  const reason = String(req.body?.reason || '').trim().slice(0, 500) || 'Suspended by admin';
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('deals')
    .update({
      is_active: false,
      admin_suspended_at: now,
      admin_suspended_reason: reason,
      updated_at: now,
    })
    .eq('id', req.params.id)
    .select()
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Deal not found' });
  await logAdminAction(req, { action: 'deal.suspend', targetType: 'deal', targetId: data.id, after: { reason } });
  res.json(data);
}

async function toggleFeatured(req, res) {
  const { is_featured } = req.body;
  const { data, error } = await supabase
    .from('businesses')
    .update({ is_featured: !!is_featured, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .maybeSingle();

  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Business not found' });
  await logAdminAction(req, {
    action: is_featured ? 'business.feature' : 'business.unfeature',
    targetType: 'business',
    targetId: data.id,
  });
  res.json(data);
}

async function broadcastNotification(req, res) {
  const { title, body, type = 'system', user_ids } = req.body;

  if (!title || !body) return res.status(422).json({ error: 'title and body required' });

  let result;
  try {
    result = await notificationService.broadcast({
      title: String(title).slice(0, 120),
      body: String(body).slice(0, 1000),
      type,
      userIds: Array.isArray(user_ids) && user_ids.length ? user_ids : null,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message || 'Broadcast failed' });
  }

  await logAdminAction(req, {
    action: 'notification.broadcast',
    targetType: 'notification',
    after: { title, recipients: result.recipients },
  });
  res.json({ sent: true, ...result });
}

async function securityChallenge(req, res) {
  const adminSecurityService = require('../services/adminSecurityService');
  try {
    const result = await adminSecurityService.requestChallenge(req.user);
    res.json({
      message: 'Verification code sent to your admin email.',
      email_hint: maskEmail(result.email),
      expires_in_seconds: result.expires_in_seconds,
    });
  } catch (err) {
    logger.error('admin security challenge failed', { message: err.message });
    res.status(500).json({ error: err.message || 'Could not send verification code' });
  }
}

async function securityVerify(req, res) {
  const adminSecurityService = require('../services/adminSecurityService');
  const { code } = req.body;
  if (!code) return res.status(422).json({ error: 'code required' });

  const result = await adminSecurityService.verifyChallenge(req.user, code);
  if (!result.ok) return res.status(400).json({ error: result.error || 'Invalid code' });

  res.json({
    action_token: result.action_token,
    expires_at: result.expires_at,
    expires_in_seconds: result.expires_in_seconds,
  });
}

async function securityStatus(req, res) {
  const adminSecurityService = require('../services/adminSecurityService');
  const token = req.headers['x-admin-action-token'];
  const status = await adminSecurityService.sessionStatus(req.user.id, token ? String(token) : '');
  res.json(status);
}

async function securityLogout(req, res) {
  const adminSecurityService = require('../services/adminSecurityService');
  await adminSecurityService.revokeSessions(req.user.id);
  res.json({ revoked: true });
}

function maskEmail(email) {
  const [user, domain] = String(email).split('@');
  if (!domain) return '***';
  const visible = user.slice(0, 2);
  return `${visible}***@${domain}`;
}

async function deleteUser(req, res) {
  const { id } = req.params;
  if (id === req.user.id) {
    return res.status(400).json({ error: 'You cannot delete your own admin account from here.' });
  }

  const { data: target, error: findErr } = await supabase
    .from('profiles')
    .select('id, email, role, full_name')
    .eq('id', id)
    .maybeSingle();

  if (findErr || !target) return res.status(404).json({ error: 'User not found' });

  if (ADMIN_ROLES.includes(target.role) && req.profile?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a super admin can delete an admin account.' });
  }

  // Never delete an account that would keep being billed.
  const { data: subscriptions } = await supabase
    .from('subscriptions')
    .select('stripe_subscription_id')
    .eq('user_id', id)
    .in('status', ['active', 'trialing', 'past_due']);
  const subIds = (subscriptions || []).map((s) => s.stripe_subscription_id).filter(Boolean);
  if (subIds.length) {
    try {
      const stripeService = require('../services/stripeService');
      await Promise.all(subIds.map((subscriptionId) => stripeService.cancelSubscriptionImmediately(subscriptionId)));
    } catch (err) {
      logger.error('deleteUser stripe cancel failed', { id, message: err.message });
      return res.status(502).json({
        error: 'Could not cancel this user’s Stripe subscription, so the account was not deleted. Try again.',
      });
    }
  }

  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) {
    logger.error('admin deleteUser failed', { id, message: error.message });
    return res.status(400).json({ error: error.message });
  }

  await logAdminAction(req, {
    action: 'user.delete',
    targetType: 'user',
    targetId: id,
    before: { email: target.email, role: target.role },
  });

  logger.info('admin wiped user', {
    admin_id: req.user.id,
    deleted_id: id,
    deleted_email: target.email,
  });

  res.json({ deleted: true, id, email: target.email });
}

module.exports = {
  stats,
  analyticsOverview,
  listUsers,
  getUser,
  updateUser,
  notifyUser,
  deleteUser,
  listBusinesses,
  approveBusiness,
  rejectBusiness,
  listDeals,
  approveDeal,
  rejectDeal,
  deleteDeal,
  toggleFeatured,
  listSubscriptions,
  broadcastNotification,
  securityChallenge,
  securityVerify,
  securityStatus,
  securityLogout,
};
