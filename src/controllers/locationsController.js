const supabase = require('../config/supabase');

async function list(req, res) {
  const { data, error } = await supabase.from('markets').select('*').order('name');
  if (error) return res.status(400).json({ error: error.message });
  res.json({ markets: data || [] });
}

async function create(req, res) {
  const { name, city, state, country, is_launched } = req.body;
  if (!name || !city) return res.status(422).json({ error: 'name and city required' });

  const { data, error } = await supabase
    .from('markets')
    .insert({
      name,
      city,
      state: state || null,
      country: country || 'US',
      is_launched: is_launched ?? false,
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
}

async function update(req, res) {
  const allowed = ['name', 'city', 'state', 'country', 'is_launched', 'waitlist_count'];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('markets')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function remove(req, res) {
  const { error } = await supabase.from('markets').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ deleted: true });
}

module.exports = { list, create, update, remove };
