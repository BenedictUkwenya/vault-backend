const supabase = require('../config/supabase');
const marketsService = require('../services/marketsService');
const notificationService = require('../services/notificationService');
const logger = require('../config/logger');

async function list(req, res) {
  await marketsService.syncAllWaitlistCounts();
  const { data, error } = await supabase.from('markets').select('*').order('name');
  if (error) return res.status(400).json({ error: error.message });
  res.json({ markets: data || [] });
}

async function create(req, res) {
  const { name, city, state, country, zip, notes, is_launched } = req.body;
  if (!name || !city) return res.status(422).json({ error: 'name and city required' });

  const { data, error } = await supabase
    .from('markets')
    .insert({
      name,
      city: String(city).trim(),
      state: state || null,
      country: country || 'United States',
      zip: zip || null,
      notes: notes || null,
      is_launched: is_launched ?? false,
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
}

async function update(req, res) {
  const { id } = req.params;
  const { data: existing } = await supabase.from('markets').select('*').eq('id', id).maybeSingle();
  if (!existing) return res.status(404).json({ error: 'Market not found' });

  const allowed = ['name', 'city', 'state', 'country', 'zip', 'notes', 'is_launched', 'waitlist_count'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('markets')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  const launching = !existing.is_launched && data.is_launched;
  if (launching) {
    try {
      const { data: waiters } = await supabase
        .from('waitlist')
        .select('user_id, email')
        .eq('market_id', id);

      for (const w of waiters || []) {
        if (!w.user_id) continue;
        try {
          await notificationService.createNotification({
            userId: w.user_id,
            title: `${data.name} is now live!`,
            body: `Black Limitless just launched in ${data.city}. Open the app to explore local deals and businesses.`,
            type: 'market_launch',
            data: { market_id: id, city: data.city },
          });
        } catch (err) {
          logger.warn('market launch notify failed', { userId: w.user_id, message: err.message });
        }
      }
    } catch (err) {
      logger.warn('market launch fan-out failed', { message: err.message });
    }
  }

  res.json(data);
}

async function remove(req, res) {
  const { error } = await supabase.from('markets').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ deleted: true });
}

module.exports = { list, create, update, remove };
