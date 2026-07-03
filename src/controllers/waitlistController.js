const supabase = require('../config/supabase');

async function join(req, res) {
  const { email, city } = req.body;
  if (!email || !city) return res.status(422).json({ error: 'email and city are required' });

  const { data, error } = await supabase
    .from('waitlist')
    .insert({ email: email.trim().toLowerCase(), city: city.trim() })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Already on waitlist for this city' });
    return res.status(400).json({ error: error.message });
  }

  res.status(201).json(data);
}

module.exports = { join };
