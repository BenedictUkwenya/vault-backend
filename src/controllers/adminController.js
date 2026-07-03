const supabase = require('../config/supabase');
const { ensureBusinessRole } = require('../utils/ensureBusinessRole');

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
  const { page = 1, limit = 50, search } = req.query;
  const offset = (page - 1) * limit;

  let query = supabase
    .from('profiles')
    .select('*', { count: 'exact' })
    .range(offset, offset + Number(limit) - 1)
    .order('created_at', { ascending: false });

  if (search) query = query.ilike('full_name', `%${search}%`);

  const { data, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });

  res.json({ users: data, total: count });
}

async function updateUser(req, res) {
  const { id } = req.params;
  const allowed = ['role', 'membership_tier', 'membership_expires_at', 'is_banned'];
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
  const { data, error } = await supabase
    .from('businesses')
    .update({ is_approved: true, updated_at: new Date().toISOString() })
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

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

  if (user_ids && user_ids.length > 0) {
    const rows = user_ids.map((id) => ({ user_id: id, title, body, type }));
    await supabase.from('notifications').insert(rows);
  } else {
    // Broadcast to all users in batches
    const { data: users } = await supabase.from('profiles').select('id');
    const rows = (users || []).map((u) => ({ user_id: u.id, title, body, type }));
    if (rows.length) await supabase.from('notifications').insert(rows);
  }

  res.json({ sent: true });
}

module.exports = {
  stats,
  listUsers,
  updateUser,
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
};
