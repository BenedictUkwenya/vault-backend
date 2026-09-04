const supabase = require('../config/supabase');
const logger = require('../config/logger');
const { ensureBusinessRole } = require('../utils/ensureBusinessRole');
const notificationService = require('../services/notificationService');

async function stats(req, res) {
  const [users, businesses, deals, activeSubscriptions] = await Promise.all([
    supabase.from('profiles').select('id', { count: 'exact', head: true }),
    supabase.from('businesses').select('id', { count: 'exact', head: true }),
    supabase.from('deals').select('id', { count: 'exact', head: true }).eq('is_active', true),
    supabase.from('subscriptions').select('id', { count: 'exact', head: true }).eq('status', 'active'),
  ]);

  res.json({
    total_users: users.count || 0,
    total_businesses: businesses.count || 0,
    active_deals: deals.count || 0,
    active_subscriptions: activeSubscriptions.count || 0,
  });
}

async function listUsers(req, res) {
  const { page = 1, limit = 50, search, role, tier, banned } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('profiles')
    .select('*', { count: 'exact' })
    .range(offset, offset + Number(limit) - 1)
    .order('created_at', { ascending: false });

  if (search) {
    const q = String(search).trim();
    query = query.or(`full_name.ilike.%${q}%,email.ilike.%${q}%`);
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
    supabase.from('businesses').select('id, name, is_approved, city').eq('owner_id', id).maybeSingle(),
  ]);

  res.json({
    ...user,
    bookings_count: bookings.count || 0,
    redemptions_count: redemptions.count || 0,
    business: business.data || null,
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

  const { data, error } = await supabase
    .from('profiles')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
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
  const { page = 1, limit = 50, status } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('businesses_with_stats')
    .select('*', { count: 'exact' })
    .range(offset, offset + Number(limit) - 1)
    .order('created_at', { ascending: false });

  if (status === 'pending') query = query.eq('is_approved', false);
  else if (status === 'approved') query = query.eq('is_approved', true);

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

  const patch = {
    is_approved: true,
    updated_at: new Date().toISOString(),
  };

  // First 100 approved partners get Founding Member status (award on approve)
  if (!existing.is_founding_member) {
    const { count } = await supabase
      .from('businesses')
      .select('id', { count: 'exact', head: true })
      .eq('is_founding_member', true);

    const foundingCount = count || 0;
    if (foundingCount < 100) {
      const { data: top } = await supabase
        .from('businesses')
        .select('founding_member_number')
        .eq('is_founding_member', true)
        .order('founding_member_number', { ascending: false })
        .limit(1)
        .maybeSingle();

      patch.is_founding_member = true;
      patch.founding_member_number = Math.min(100, (top?.founding_member_number || 0) + 1);
    }
  }

  const { data, error } = await supabase
    .from('businesses')
    .update(patch)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) {
    logger.error('approveBusiness failed', { id: req.params.id, error: error.message, patch });
    return res.status(400).json({ error: error.message });
  }

  if (data?.owner_id) await ensureBusinessRole(data.owner_id);

  res.json(data);
}

async function rejectBusiness(req, res) {
  const { reason } = req.body;
  const { data, error } = await supabase
    .from('businesses')
    .update({ is_approved: false, rejection_reason: reason, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function listDeals(req, res) {
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('deals_with_business')
    .select('*', { count: 'exact' })
    .range(offset, offset + Number(limit) - 1)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ deals: data, total: count });
}

async function approveDeal(req, res) {
  const { data, error } = await supabase
    .from('deals')
    .update({ is_active: true, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function deleteDeal(req, res) {
  const { error } = await supabase
    .from('deals')
    .delete()
    .eq('id', req.params.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ deleted: true });
}

async function listSubscriptions(req, res) {
  const { page = 1, limit = 50 } = req.query;
  const offset = (page - 1) * limit;

  const { data, error, count } = await supabase
    .from('subscriptions')
    .select('*, profiles(full_name, email)', { count: 'exact' })
    .range(offset, offset + Number(limit) - 1)
    .order('created_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ subscriptions: data, total: count });
}

async function rejectDeal(req, res) {
  const { data, error } = await supabase
    .from('deals')
    .update({
      is_active: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function toggleFeatured(req, res) {
  const { is_featured } = req.body;
  const { data, error } = await supabase
    .from('businesses')
    .update({ is_featured: !!is_featured, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function broadcastNotification(req, res) {
  const { title, body, type = 'system', user_ids } = req.body;

  if (!title || !body) return res.status(422).json({ error: 'title and body required' });

  let ids = user_ids;
  if (!ids || !ids.length) {
    const { data: users } = await supabase.from('profiles').select('id');
    ids = (users || []).map((u) => u.id);
  }

  await notificationService.createNotifications(
    (ids || []).map((id) => ({ userId: id, title, body, type }))
  );

  res.json({ sent: true });
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

  if (target.role === 'super_admin' && req.profile?.role !== 'super_admin') {
    return res.status(403).json({ error: 'Only a super admin can delete another super admin.' });
  }

  // Cancel Stripe subscriptions if present
  try {
    const stripeService = require('../services/stripeService');
    const { data: subscriptions } = await supabase
      .from('subscriptions')
      .select('stripe_subscription_id')
      .eq('user_id', id)
      .in('status', ['active', 'trialing', 'past_due']);

    await Promise.all(
      (subscriptions || [])
        .map((s) => s.stripe_subscription_id)
        .filter(Boolean)
        .map((subscriptionId) => stripeService.cancelSubscriptionImmediately(subscriptionId).catch(() => null))
    );
  } catch (err) {
    logger.warn('deleteUser stripe cancel skipped', { message: err.message });
  }

  // Soft-lock profile first in case auth delete partially fails
  await supabase
    .from('profiles')
    .update({ is_banned: true, updated_at: new Date().toISOString() })
    .eq('id', id);

  const { error } = await supabase.auth.admin.deleteUser(id);
  if (error) {
    logger.error('admin deleteUser failed', { id, message: error.message });
    return res.status(400).json({ error: error.message });
  }

  logger.info('admin wiped user', {
    admin_id: req.user.id,
    deleted_id: id,
    deleted_email: target.email,
  });

  res.json({ deleted: true, id, email: target.email });
}

module.exports = {
  stats,
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
