const supabase = require('../config/supabase');

const EVENT_NAME = /^[a-z0-9_]{1,64}$/;
const MAX_BATCH = 50;
const MAX_PROPS_BYTES = 2048;
const MAX_CLOCK_SKEW_MS = 7 * 24 * 60 * 60 * 1000;

function sanitizeProps(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const out = {};
  for (const [key, value] of Object.entries(raw).slice(0, 20)) {
    const k = String(key).slice(0, 40);
    if (value === null || typeof value === 'number' || typeof value === 'boolean') out[k] = value;
    else if (value !== undefined) out[k] = String(value).slice(0, 200);
  }
  return JSON.stringify(out).length > MAX_PROPS_BYTES ? {} : out;
}

function toRow(raw, { userId, platform, appVersion }) {
  const event = String(raw?.event || '').trim();
  if (!EVENT_NAME.test(event)) return null;

  const ts = Number(raw?.ts);
  const createdAt =
    Number.isFinite(ts) && Math.abs(Date.now() - ts) < MAX_CLOCK_SKEW_MS
      ? new Date(ts).toISOString()
      : new Date().toISOString();

  return {
    user_id: userId,
    event,
    props: sanitizeProps(raw?.props),
    platform,
    app_version: appVersion,
    session_id: raw?.session_id ? String(raw.session_id).slice(0, 64) : null,
    created_at: createdAt,
  };
}

async function trackEvent(req, res) {
  const row = toRow(req.body, {
    userId: req.user?.id || null,
    platform: String(req.body?.platform || 'mobile').slice(0, 32),
    appVersion: req.body?.app_version ? String(req.body.app_version).slice(0, 32) : null,
  });
  if (!row) return res.status(422).json({ error: 'valid event required' });

  const { error } = await supabase.from('analytics_events').insert(row);
  if (error) return res.status(202).json({ accepted: false, error: error.message });
  res.status(202).json({ accepted: true });
}

async function trackBatch(req, res) {
  const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, MAX_BATCH) : [];
  if (!events.length) return res.status(422).json({ error: 'events required' });

  const ctx = {
    userId: req.user?.id || null,
    platform: String(req.body?.platform || 'mobile').slice(0, 32),
    appVersion: req.body?.app_version ? String(req.body.app_version).slice(0, 32) : null,
  };
  const rows = events.map((e) => toRow(e, ctx)).filter(Boolean);
  if (!rows.length) return res.status(422).json({ error: 'no valid events' });

  const { error } = await supabase.from('analytics_events').insert(rows);
  // Accept even on failure so clients don't retry-loop against a missing table.
  if (error) return res.status(202).json({ accepted: 0, error: error.message });
  res.status(202).json({ accepted: rows.length });
}

module.exports = { trackEvent, trackBatch };
