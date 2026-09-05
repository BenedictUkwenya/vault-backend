const supabase = require('../config/supabase');

async function trackEvent(req, res) {
  const event = String(req.body?.event || '').trim().slice(0, 120);
  if (!event) return res.status(422).json({ error: 'event required' });

  const props = req.body?.props && typeof req.body.props === 'object' ? req.body.props : {};
  const platform = String(req.body?.platform || 'mobile').slice(0, 32);

  const { error } = await supabase.from('analytics_events').insert({
    user_id: req.user?.id || null,
    event,
    props,
    platform,
  });

  if (error) {
    // Table may not exist yet — don't fail clients hard
    return res.status(202).json({ accepted: false, error: error.message });
  }

  res.status(202).json({ accepted: true });
}

module.exports = { trackEvent };
