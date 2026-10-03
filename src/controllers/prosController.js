const supabase = require('../config/supabase');
const logger = require('../config/logger');
const notificationService = require('../services/notificationService');
const qaService = require('../services/qaService');
const { logAdminAction } = require('../utils/adminAudit');

const FOUNDING_CAPACITY = 100;
const PUBLIC_COLUMNS =
  'id, display_name, profession, bio, city, state, country, phone, email, website, instagram_handle, ' +
  'years_experience, services, avatar_url, portfolio_urls, is_founding, founding_number, approved_at, created_at';
const STATUSES = ['pending', 'approved', 'rejected', 'suspended'];

function safeSearchTerm(value) {
  return String(value || '')
    .replace(/[,()%*\\]/g, ' ')
    .trim()
    .slice(0, 60);
}

function cleanText(value, max) {
  const s = String(value ?? '').trim();
  return s ? s.slice(0, max) : null;
}

function cleanUrls(value, max) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((u) => typeof u === 'string' && /^https:\/\//i.test(u.trim()))
    .map((u) => u.trim())
    .slice(0, max);
}

function cleanServices(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((s) => String(s || '').trim().slice(0, 40)).filter(Boolean))].slice(0, 15);
}

/** Validates an application body; returns { row } or { error }. */
function buildApplication(body) {
  const row = {
    display_name: cleanText(body.display_name, 80),
    profession: cleanText(body.profession, 60),
    bio: cleanText(body.bio, 1500),
    city: cleanText(body.city, 80),
    state: cleanText(body.state, 80),
    country: cleanText(body.country, 80) || 'United States',
    phone: cleanText(body.phone, 40),
    email: cleanText(body.email, 120),
    website: cleanText(body.website, 200),
    instagram_handle: cleanText(String(body.instagram_handle || '').replace(/^@/, ''), 60),
    years_experience:
      body.years_experience === undefined || body.years_experience === null || body.years_experience === ''
        ? null
        : Math.max(0, Math.min(80, parseInt(body.years_experience, 10) || 0)),
    services: cleanServices(body.services),
    avatar_url: cleanUrls([body.avatar_url], 1)[0] || null,
    portfolio_urls: cleanUrls(body.portfolio_urls, 12),
    proof_urls: cleanUrls(body.proof_urls, 6),
  };

  if (!row.display_name || row.display_name.length < 2) return { error: 'Add your name or brand name.' };
  if (!row.profession || row.profession.length < 2) return { error: 'Tell us your profession.' };
  if (!row.bio || row.bio.length < 30) return { error: 'Your bio should be at least 30 characters.' };
  if (!row.city) return { error: 'Add the city you work in.' };
  if (!row.phone && !row.email) return { error: 'Add a phone number or email so members can reach you.' };
  if (!row.services.length) return { error: 'List at least one service you offer.' };
  if (row.portfolio_urls.length < 3) return { error: 'Upload at least 3 photos or videos of your work.' };
  if (!row.proof_urls.length) return { error: 'Upload proof of your services (license, certificate or business registration).' };
  if (body.accepted_terms !== true) return { error: 'Please accept the BL Pro terms to apply.' };
  return { row };
}

async function list(req, res) {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit, 10) || 30));
  let query = supabase
    .from('bl_pros')
    .select(PUBLIC_COLUMNS)
    .eq('status', 'approved')
    .order('is_founding', { ascending: false })
    .order('founding_number', { ascending: true, nullsFirst: false })
    .order('approved_at', { ascending: false })
    .limit(limit);

  const q = safeSearchTerm(req.query.search);
  if (q) query = query.or(`display_name.ilike.%${q}%,profession.ilike.%${q}%`);
  const profession = safeSearchTerm(req.query.profession);
  if (profession) query = query.ilike('profession', `%${profession}%`);
  const city = safeSearchTerm(req.query.city);
  if (city) query = query.ilike('city', `%${city}%`);

  const { data, error } = await query;
  if (error) return res.status(400).json({ error: error.message });
  res.json({ pros: data || [] });
}

async function foundingWall(req, res) {
  const [{ data, error }, { count }] = await Promise.all([
    supabase
      .from('bl_pros')
      .select('id, display_name, profession, avatar_url, city, state, founding_number')
      .eq('status', 'approved')
      .eq('is_founding', true)
      .order('founding_number', { ascending: true })
      .limit(FOUNDING_CAPACITY),
    supabase
      .from('bl_pros')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'approved')
      .eq('is_founding', true),
  ]);
  if (error) return res.status(400).json({ error: error.message });
  res.json({
    title: 'BL Pro Founding Wall',
    subtitle: 'The first 100 verified professionals — permanent recognition for the pros who launched BL Pro.',
    pros: data || [],
    total: count || 0,
    capacity: FOUNDING_CAPACITY,
  });
}

async function getMy(req, res) {
  const { data, error } = await supabase.from('bl_pros').select('*').eq('user_id', req.user.id).maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ pro: data || null });
}

async function getById(req, res) {
  const { data, error } = await supabase
    .from('bl_pros')
    .select(`${PUBLIC_COLUMNS}, status, user_id`)
    .eq('id', req.params.id)
    .maybeSingle();
  if (error) return res.status(400).json({ error: error.message });
  const isOwner = data && req.user?.id === data.user_id;
  if (!data || (data.status !== 'approved' && !isOwner)) return res.status(404).json({ error: 'BL Pro not found' });
  const { user_id: _userId, ...pro } = data;
  res.json(pro);
}

async function apply(req, res) {
  const { row, error: invalid } = buildApplication(req.body || {});
  if (invalid) return res.status(400).json({ error: invalid });

  const { data: existing } = await supabase
    .from('bl_pros')
    .select('id, status')
    .eq('user_id', req.user.id)
    .maybeSingle();

  const now = new Date().toISOString();
  const payload = {
    ...row,
    status: 'pending',
    rejection_reason: null,
    terms_accepted_at: now,
    updated_at: now,
  };

  if (existing && existing.status === 'approved') {
    return res.status(409).json({ error: 'You are already a verified BL Pro.' });
  }

  const { data, error } = existing
    ? await supabase.from('bl_pros').update(payload).eq('id', existing.id).select().single()
    : await supabase
        .from('bl_pros')
        .insert({ ...payload, user_id: req.user.id })
        .select()
        .single();

  if (error) {
    logger.error('BL Pro application failed', { userId: req.user.id, error: error.message });
    return res.status(400).json({ error: error.message });
  }
  await notifyAdminsOfApplication(data, !!existing);
  res.status(existing ? 200 : 201).json({ pro: data, resubmitted: !!existing });
}

async function notifyAdminsOfApplication(pro, resubmitted) {
  try {
    const { data: admins } = await supabase
      .from('profiles')
      .select('id')
      .in('role', ['admin', 'super_admin']);
    if (!admins?.length) return;
    const place = [pro.city, pro.state].filter(Boolean).join(', ');
    await notificationService.createNotifications(
      admins.map((a) => ({
        userId: a.id,
        title: resubmitted ? 'BL Pro application resubmitted' : 'New BL Pro application',
        body: `${pro.display_name} (${pro.profession}${place ? ` · ${place}` : ''}) is waiting for verification.`,
        type: 'system',
        data: { kind: 'pro_application', pro_id: pro.id },
      }))
    );
  } catch (err) {
    logger.warn('BL Pro admin notification failed', { proId: pro?.id, message: err.message });
  }
}

async function adminList(req, res) {
  const status = STATUSES.includes(req.query.status) ? req.query.status : 'pending';
  const { data, error } = await supabase
    .from('bl_pros')
    .select('*, owner:user_id(full_name, email)')
    .eq('status', status)
    .order('created_at', { ascending: status === 'pending' })
    .limit(100);
  if (error) return res.status(400).json({ error: error.message });

  const counts = await Promise.all(
    STATUSES.map((s) =>
      supabase
        .from('bl_pros')
        .select('id', { count: 'exact', head: true })
        .eq('status', s)
        .then((r) => r.count || 0)
    )
  );
  res.json({ pros: data || [], counts: Object.fromEntries(STATUSES.map((s, i) => [s, counts[i]])) });
}

async function nextFoundingNumber() {
  const { data } = await supabase.from('bl_pros').select('founding_number').not('founding_number', 'is', null);
  const used = new Set((data || []).map((r) => r.founding_number));
  for (let n = 1; n <= FOUNDING_CAPACITY; n += 1) {
    if (!used.has(n)) return n;
  }
  return null;
}

async function adminApprove(req, res) {
  const checklist = qaService.normalizeChecklist('pro', req.body?.checklist);
  if (!qaService.isComplete('pro', checklist)) {
    return res.status(400).json({ error: 'Complete every quality-assurance check before approving.' });
  }

  const { data: existing } = await supabase
    .from('bl_pros')
    .select('id, user_id, display_name, status, is_founding')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'BL Pro not found' });

  const now = new Date().toISOString();
  const patch = {
    status: 'approved',
    rejection_reason: null,
    approved_at: now,
    reviewed_at: now,
    reviewed_by: req.user.id,
    updated_at: now,
  };
  if (!existing.is_founding) {
    const next = await nextFoundingNumber();
    if (next) Object.assign(patch, { is_founding: true, founding_number: next });
  }

  let { data, error } = await supabase.from('bl_pros').update(patch).eq('id', existing.id).select().single();
  if (error && error.code === '23505' && patch.founding_number) {
    // Lost a race for the number; approve without founding status rather than failing.
    delete patch.is_founding;
    delete patch.founding_number;
    ({ data, error } = await supabase.from('bl_pros').update(patch).eq('id', existing.id).select().single());
  }
  if (error) return res.status(400).json({ error: error.message });

  await qaService.recordReview({
    entityType: 'pro',
    entityId: existing.id,
    reviewerId: req.user.id,
    checklist,
    outcome: 'approved',
    notes: req.body?.notes,
  });
  await notificationService
    .createNotification({
      userId: existing.user_id,
      title: "You're a verified BL Pro 🎉",
      body: data.is_founding
        ? `Welcome, Founding BL Pro #${data.founding_number}. Your profile is now live for members.`
        : 'Your BL Pro profile is now live for members.',
      type: 'system',
      data: { kind: 'pro_approved', pro_id: existing.id },
    })
    .catch(() => null);
  await logAdminAction(req, {
    action: 'pro.approve',
    targetType: 'pro',
    targetId: existing.id,
    before: { status: existing.status },
    after: { status: 'approved', founding_number: data.founding_number },
  });
  res.json(data);
}

async function adminReject(req, res) {
  const reason = String(req.body?.reason || '').trim().slice(0, 500) || 'Does not meet BL Pro requirements yet';
  const { data: existing } = await supabase
    .from('bl_pros')
    .select('id, user_id, status')
    .eq('id', req.params.id)
    .maybeSingle();
  if (!existing) return res.status(404).json({ error: 'BL Pro not found' });

  const nextStatus = existing.status === 'approved' ? 'suspended' : 'rejected';
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from('bl_pros')
    .update({
      status: nextStatus,
      rejection_reason: reason,
      reviewed_at: now,
      reviewed_by: req.user.id,
      updated_at: now,
    })
    .eq('id', existing.id)
    .select()
    .single();
  if (error) return res.status(400).json({ error: error.message });

  await qaService.recordReview({
    entityType: 'pro',
    entityId: existing.id,
    reviewerId: req.user.id,
    checklist: qaService.normalizeChecklist('pro', req.body?.checklist),
    outcome: 'rejected',
    notes: reason,
  });
  await notificationService
    .createNotification({
      userId: existing.user_id,
      title: nextStatus === 'suspended' ? 'Your BL Pro profile was paused' : 'Update on your BL Pro application',
      body: `Reason: ${reason}. Update your application from the BL Pro tab and resubmit.`,
      type: 'system',
      data: { kind: `pro_${nextStatus}`, pro_id: existing.id },
    })
    .catch(() => null);
  await logAdminAction(req, {
    action: `pro.${nextStatus === 'suspended' ? 'suspend' : 'reject'}`,
    targetType: 'pro',
    targetId: existing.id,
    before: { status: existing.status },
    after: { status: nextStatus, reason },
  });
  res.json(data);
}

async function adminQaReviews(req, res) {
  const entityType = req.query.entity_type === 'pro' ? 'pro' : 'business';
  const reviews = req.query.entity_id ? await qaService.listReviews(entityType, req.query.entity_id) : [];
  res.json({ checklist: qaService.CHECKLISTS[entityType], reviews });
}

async function membersFoundingWall(req, res) {
  const { data, error, count } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, city, created_at', { count: 'exact' })
    .not('role', 'in', '(admin,super_admin)')
    .or('is_banned.is.null,is_banned.eq.false')
    .order('created_at', { ascending: true })
    .limit(FOUNDING_CAPACITY);
  if (error) return res.status(400).json({ error: error.message });

  const members = (data || []).map((p, i) => {
    const parts = String(p.full_name || 'Member').trim().split(/\s+/);
    const name = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0];
    return { id: p.id, name, avatar_url: p.avatar_url, city: p.city, founding_number: i + 1, joined_at: p.created_at };
  });
  res.json({
    title: 'Founding Members',
    subtitle: 'The first 100 members to join Black Limitless — the people who believed first.',
    members,
    total: Math.min(count || members.length, FOUNDING_CAPACITY),
    capacity: FOUNDING_CAPACITY,
  });
}

module.exports = {
  list,
  foundingWall,
  getMy,
  getById,
  apply,
  adminList,
  adminApprove,
  adminReject,
  adminQaReviews,
  membersFoundingWall,
};
