const supabase = require('../config/supabase');

function normalizeBool(value) {
  if (typeof value === 'boolean') return value;
  const s = String(value || '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}

async function apply(req, res) {
  const {
    full_name,
    name,
    email,
    phone,
    number,
    location,
    business,
    business_description,
    student,
    is_student,
    membership,
    membership_interest,
    hear,
    hear_about,
    applicant_type,
    source_page,
  } = req.body || {};

  const fullName = String(full_name || name || '').trim();
  const emailNorm = String(email || '').trim().toLowerCase();
  const phoneNorm = String(phone || number || '').trim();
  const locationNorm = String(location || '').trim();
  const businessDesc = String(business_description || business || '').trim() || null;
  const membershipInterest = String(membership_interest || membership || '').trim();
  const hearAbout = String(hear_about || hear || '').trim();
  const type = applicant_type === 'partner' ? 'partner' : 'member';

  if (!fullName || !emailNorm || !phoneNorm || !locationNorm || !membershipInterest || !hearAbout) {
    return res.status(422).json({
      error: 'full_name, email, phone, location, membership_interest, and hear_about are required',
    });
  }

  if (!emailNorm.includes('@')) {
    return res.status(422).json({ error: 'Valid email is required' });
  }

  // Soft de-dupe: same email pending within 7 days
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: existing } = await supabase
    .from('network_applications')
    .select('id, status, created_at')
    .eq('email', emailNorm)
    .eq('status', 'pending')
    .gte('created_at', weekAgo)
    .maybeSingle();

  if (existing?.id) {
    return res.status(409).json({
      error: 'You already have a pending application. We will review it soon.',
      application_id: existing.id,
    });
  }

  const { data, error } = await supabase
    .from('network_applications')
    .insert({
      full_name: fullName,
      email: emailNorm,
      phone: phoneNorm,
      location: locationNorm,
      business_description: businessDesc,
      is_student: normalizeBool(is_student ?? student),
      membership_interest: membershipInterest,
      hear_about: hearAbout,
      applicant_type: type,
      source_page: source_page ? String(source_page).slice(0, 120) : null,
    })
    .select('id, status, created_at')
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.status(201).json({
    id: data.id,
    status: data.status,
    message: 'Application received. Our team will review and contact you.',
  });
}

async function list(req, res) {
  const { status, page = 1, limit = 50 } = req.query;
  const offset = (Number(page) - 1) * Number(limit);

  let query = supabase
    .from('network_applications')
    .select('*', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(offset, offset + Number(limit) - 1);

  if (status) query = query.eq('status', status);

  const { data, error, count } = await query;
  if (error) return res.status(400).json({ error: error.message });

  res.json({
    applications: data || [],
    total: count || 0,
    page: Number(page),
    limit: Number(limit),
  });
}

async function updateStatus(req, res) {
  const { id } = req.params;
  const { status, notes } = req.body || {};
  const allowed = ['pending', 'reviewing', 'approved', 'rejected', 'contacted'];
  if (!allowed.includes(status)) {
    return res.status(422).json({ error: `status must be one of: ${allowed.join(', ')}` });
  }

  const updates = { status, updated_at: new Date().toISOString() };
  if (notes !== undefined) updates.notes = notes;

  const { data, error } = await supabase
    .from('network_applications')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

module.exports = { apply, list, updateStatus };
