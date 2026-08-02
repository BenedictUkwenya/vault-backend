const supabase = require('../config/supabase');

function normalizePlatforms(platforms) {
  if (!Array.isArray(platforms)) return [];
  return platforms
    .filter((p) => p && typeof p.platform === 'string' && typeof p.url === 'string' && p.url.trim())
    .map((p) => ({
      platform: String(p.platform).toLowerCase().trim(),
      url: String(p.url).trim(),
    }));
}

async function listPublic(req, res) {
  const { data, error } = await supabase
    .from('media_posts')
    .select('*')
    .eq('is_published', true)
    .order('sort_order', { ascending: true })
    .order('published_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ posts: data || [] });
}

async function getById(req, res) {
  const { data, error } = await supabase
    .from('media_posts')
    .select('*')
    .eq('id', req.params.id)
    .eq('is_published', true)
    .single();

  if (error || !data) return res.status(404).json({ error: 'Media post not found' });
  res.json(data);
}

async function listAdmin(req, res) {
  const { data, error } = await supabase
    .from('media_posts')
    .select('*')
    .order('sort_order', { ascending: true })
    .order('published_at', { ascending: false });

  if (error) return res.status(400).json({ error: error.message });
  res.json({ posts: data || [] });
}

async function create(req, res) {
  const {
    title,
    caption,
    thumbnail_url,
    video_url,
    video_provider = 'youtube',
    platforms,
    published_at,
    is_published = true,
    sort_order = 0,
  } = req.body;

  if (!title || !String(title).trim()) {
    return res.status(422).json({ error: 'title required' });
  }

  const provider = ['youtube', 'file', 'external'].includes(video_provider)
    ? video_provider
    : 'youtube';

  const { data, error } = await supabase
    .from('media_posts')
    .insert({
      title: String(title).trim(),
      caption: caption ? String(caption).trim() : null,
      thumbnail_url: thumbnail_url || null,
      video_url: video_url || null,
      video_provider: provider,
      platforms: normalizePlatforms(platforms),
      published_at: published_at || new Date().toISOString(),
      is_published: !!is_published,
      sort_order: Number(sort_order) || 0,
    })
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.status(201).json(data);
}

async function update(req, res) {
  const allowed = [
    'title',
    'caption',
    'thumbnail_url',
    'video_url',
    'video_provider',
    'platforms',
    'published_at',
    'is_published',
    'sort_order',
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }
  if (updates.title !== undefined) updates.title = String(updates.title).trim();
  if (updates.platforms !== undefined) updates.platforms = normalizePlatforms(updates.platforms);
  if (updates.video_provider !== undefined && !['youtube', 'file', 'external'].includes(updates.video_provider)) {
    return res.status(422).json({ error: 'invalid video_provider' });
  }
  if (updates.sort_order !== undefined) updates.sort_order = Number(updates.sort_order) || 0;
  updates.updated_at = new Date().toISOString();

  const { data, error } = await supabase
    .from('media_posts')
    .update(updates)
    .eq('id', req.params.id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

async function remove(req, res) {
  const { error } = await supabase.from('media_posts').delete().eq('id', req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ deleted: true });
}

module.exports = {
  listPublic,
  getById,
  listAdmin,
  create,
  update,
  remove,
};
