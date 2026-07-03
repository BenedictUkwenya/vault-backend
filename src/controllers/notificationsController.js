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

module.exports = { list, markRead, markAllRead, unreadCount };
