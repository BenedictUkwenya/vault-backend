const supabase = require('../config/supabase');

async function submit(req, res) {
  const { rating, category, message } = req.body;
  if (!message?.trim()) return res.status(422).json({ error: 'message is required' });

  const { data, error } = await supabase
    .from('feedback')
    .insert({
      user_id: req.user?.id || null,
      rating: rating || null,
      category: category || 'general',
      message: message.trim(),
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
}

module.exports = { submit };
