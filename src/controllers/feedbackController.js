const supabase = require('../config/supabase');
const membership = require('../services/membershipService');

async function submit(req, res) {
  const { rating, category, message } = req.body;
  if (!message?.trim()) return res.status(422).json({ error: 'message is required' });

  const row = {
    user_id: req.user?.id || null,
    rating: rating || null,
    category: category || 'general',
    message: message.trim(),
    // VIP messages go to the top of the admin support queue.
    is_priority: membership.isVip(membership.effectiveTier(req.profile)),
  };
  let { data, error } = await supabase.from('feedback').insert(row).select().single();
  if (error && /is_priority/.test(error.message || '')) {
    // Migration 045 not applied yet: still accept the message.
    delete row.is_priority;
    ({ data, error } = await supabase.from('feedback').insert(row).select().single());
  }

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
}

/** The signed-in member's messages, newest first, with any team reply. */
async function mine(req, res) {
  const { data, error } = await supabase
    .from('feedback')
    .select('id, category, message, rating, status, created_at, admin_reply, replied_at')
    .eq('user_id', req.user.id)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ messages: data || [] });
}

module.exports = { submit, mine };
