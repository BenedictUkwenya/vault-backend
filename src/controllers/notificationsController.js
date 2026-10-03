const supabase = require('../config/supabase');

async function list(req, res) {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function markRead(req, res) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ read: true });
}

async function markAllRead(req, res) {
  const { error } = await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', req.user.id)
    .eq('is_read', false);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ updated: true });
}

async function unreadCount(req, res) {
  const { count, error } = await supabase
    .from('notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', req.user.id)
    .eq('is_read', false);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ count: count || 0 });
}

const ADMIN_ROLES = ['admin', 'super_admin'];

function headCount(query) {
  return query.then(({ count, error }) => (error ? 0 : count || 0));
}

/**
 * Every badge number the app shows, in one cheap call. Counts only (no PII),
 * so admin queue sizes are safe to return without the admin step-up code.
 */
async function badges(req, res) {
  const userId = req.user.id;
  const role = req.profile?.role;
  const isAdmin = ADMIN_ROLES.includes(role);
  const since = Date.parse(req.query.deals_since);

  const [unread, newDeals, ownedBusinesses] = await Promise.all([
    headCount(
      supabase.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('is_read', false)
    ),
    Number.isFinite(since)
      ? headCount(
          supabase
            .from('deals_with_business')
            .select('id', { count: 'exact', head: true })
            .eq('is_active', true)
            .eq('business_is_approved', true)
            .gt('end_date', new Date().toISOString())
            .gt('created_at', new Date(since).toISOString())
        )
      : Promise.resolve(0),
    supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', userId)
      .then(({ data }) => (data || []).map((b) => b.id)),
  ]);

  const pendingBookings = ownedBusinesses.length
    ? await headCount(
        supabase
          .from('bookings')
          .select('id', { count: 'exact', head: true })
          .in('business_id', ownedBusinesses)
          .eq('status', 'pending')
      )
    : 0;

  let admin = null;
  if (isAdmin) {
    const [pros, businesses, network] = await Promise.all([
      headCount(supabase.from('bl_pros').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
      headCount(supabase.from('businesses').select('id', { count: 'exact', head: true }).eq('review_status', 'pending')),
      headCount(
        supabase.from('network_applications').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      ),
    ]);
    admin = { pros, businesses, network, total: pros + businesses + network };
  }

  res.json({
    unread,
    newDeals,
    business: ownedBusinesses.length ? { pendingBookings } : null,
    admin,
  });
}

async function remove(req, res) {
  const { error } = await supabase
    .from('notifications')
    .delete()
    .eq('id', req.params.id)
    .eq('user_id', req.user.id);

  if (error) return res.status(400).json({ error: error.message });
  res.json({ deleted: true });
}

module.exports = { list, markRead, markAllRead, unreadCount, badges, remove };
