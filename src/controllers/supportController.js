const supabase = require('../config/supabase');
const logger = require('../config/logger');
const notificationService = require('../services/notificationService');

/** Admin support inbox: open messages first, VIP (priority) pinned to the top. */
async function adminListFeedback(req, res) {
  const status = req.query.status === 'resolved' ? 'resolved' : 'open';
  const { data, error } = await supabase
    .from('feedback')
    .select('id, rating, category, message, is_priority, status, created_at, resolved_at, user:user_id(id, full_name, email, membership_tier)')
    .eq('status', status)
    .order('is_priority', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(400).json({ error: error.message });

  const { count: priorityOpen } = await supabase
    .from('feedback')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'open')
    .eq('is_priority', true);

  res.json({ feedback: data || [], priority_open: priorityOpen || 0 });
}

async function adminUpdateFeedback(req, res) {
  const status = req.body?.status === 'resolved' ? 'resolved' : 'open';
  const { data, error } = await supabase
    .from('feedback')
    .update({ status, resolved_at: status === 'resolved' ? new Date().toISOString() : null })
    .eq('id', req.params.id)
    .select('id, status')
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Message not found' });
  res.json(data);
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

/** Active VIPs right now: these are this month's giveaway entrants. */
async function activeVips() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, email, membership_expires_at, is_banned')
    .eq('membership_tier', 'vip');
  if (error) throw new Error(error.message);
  const now = Date.now();
  return (data || []).filter(
    (p) => !p.is_banned && (!p.membership_expires_at || new Date(p.membership_expires_at).getTime() > now)
  );
}

async function adminGiveaway(_req, res) {
  const month = currentMonth();
  const [entrants, { data: history, error }] = await Promise.all([
    activeVips(),
    supabase
      .from('vip_giveaways')
      .select('id, month, prize, entrants, drawn_at, winner:winner_id(id, full_name, email)')
      .order('month', { ascending: false })
      .limit(12),
  ]);
  if (error) return res.status(400).json({ error: error.message });
  res.json({
    month,
    entrants_count: entrants.length,
    current: (history || []).find((g) => g.month === month) || null,
    history: history || [],
  });
}

async function adminDrawGiveaway(req, res) {
  const month = currentMonth();
  const prize = String(req.body?.prize || '').trim().slice(0, 200);
  if (prize.length < 3) return res.status(400).json({ error: 'Describe the prize so the winner knows what they won.' });

  const { data: existing } = await supabase.from('vip_giveaways').select('id').eq('month', month).maybeSingle();
  if (existing) return res.status(409).json({ error: 'This month’s winner has already been drawn.' });

  const entrants = await activeVips();
  if (!entrants.length) return res.status(400).json({ error: 'There are no active VIP members to draw from yet.' });

  const winner = entrants[require('crypto').randomInt(entrants.length)];
  const { data, error } = await supabase
    .from('vip_giveaways')
    .insert({ month, prize, winner_id: winner.id, entrants: entrants.length, drawn_by: req.user.id })
    .select('id, month, prize, entrants, drawn_at')
    .single();
  if (error?.code === '23505') return res.status(409).json({ error: 'This month’s winner has already been drawn.' });
  if (error) return res.status(400).json({ error: error.message });

  try {
    await notificationService.createNotification({
      userId: winner.id,
      title: 'You won this month’s VIP giveaway 🎉',
      body: `Congratulations! You won: ${prize}. Our team will contact you to arrange it.`,
      type: 'giveaway',
      data: { kind: 'giveaway', month },
    });
  } catch (err) {
    logger.warn({ message: 'giveaway winner notification failed', error: err.message });
  }

  res.json({ ...data, winner: { id: winner.id, full_name: winner.full_name, email: winner.email } });
}

module.exports = { adminListFeedback, adminUpdateFeedback, adminGiveaway, adminDrawGiveaway };
