const supabase = require('../config/supabase');

const VALID_TIERS = ['free', 'student', 'member', 'vip'];

function normalizeBool(value) {
  if (typeof value === 'boolean') return value;
  const s = String(value || '').trim().toLowerCase();
  return s === 'yes' || s === 'true' || s === '1';
}

/** Map marketing form interest → preferred app membership_tier (they pay later) */
function suggestTier(application, overrideTier) {
  if (overrideTier && VALID_TIERS.includes(overrideTier)) return overrideTier;
  if (application.is_student) return 'student';

  const interest = String(application.membership_interest || '').trim().toLowerCase();
  if (interest.includes('vip')) return 'vip';
  if (interest.includes('premium') || interest.includes('member')) return 'member';
  if (interest.includes('basic')) return 'free';
  if (interest.includes('not sure')) return 'member';
  return 'member';
}

function inviteRedirectUrl() {
  return (
    process.env.NETWORK_INVITE_REDIRECT_URL ||
    process.env.FRONTEND_URL ||
    'https://www.blacklimitless.com'
  );
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

  if (status === 'approved') {
    return res.status(400).json({
      error: 'Use POST /api/network/applications/:id/approve to approve and invite the applicant',
    });
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

async function findProfileByEmail(email) {
  const { data } = await supabase
    .from('profiles')
    .select('id, email, membership_tier, full_name')
    .ilike('email', email)
    .maybeSingle();
  return data || null;
}

/**
 * After invite: keep account on Free unless admin comps a plan.
 * preferred_membership_tier drives the in-app Stripe subscribe nudge.
 */
async function syncProfileAfterInvite(userId, application, preferredTier, { comp = false } = {}) {
  const patch = {
    full_name: application.full_name || undefined,
    phone: application.phone || undefined,
    city: application.location || undefined,
    preferred_membership_tier: preferredTier === 'free' ? null : preferredTier,
    updated_at: new Date().toISOString(),
  };

  if (comp && preferredTier !== 'free') {
    patch.membership_tier = preferredTier;
    patch.membership_expires_at = null;
    if (preferredTier === 'student') {
      patch.student_verified_at = new Date().toISOString();
    }
  } else {
    // Do not overwrite an existing paid subscriber
    const { data: current } = await supabase
      .from('profiles')
      .select('membership_tier')
      .eq('id', userId)
      .maybeSingle();
    const currentTier = current?.membership_tier;
    if (!currentTier || currentTier === 'free' || currentTier === 'paid') {
      patch.membership_tier = 'free';
      patch.membership_expires_at = null;
    }
  }

  const { error } = await supabase.from('profiles').update(patch).eq('id', userId);
  if (error) throw new Error(error.message);
}

/**
 * Approve application → invite user → set preferred plan (pay in app).
 * Optional body.comp_membership = true gifts the tier without Stripe.
 */
async function approve(req, res) {
  const { id } = req.params;
  const { membership_tier, notes, comp_membership } = req.body || {};
  const comp = !!comp_membership;

  const { data: app, error: fetchError } = await supabase
    .from('network_applications')
    .select('*')
    .eq('id', id)
    .single();

  if (fetchError || !app) return res.status(404).json({ error: 'Application not found' });

  if (['rejected'].includes(app.status)) {
    return res.status(400).json({ error: 'Cannot approve a rejected application' });
  }

  if (app.status === 'approved' && app.invited_user_id) {
    return res.json({
      application: app,
      message: 'Already approved and invited',
      already_done: true,
    });
  }

  const preferredTier = suggestTier(app, membership_tier);
  let userId = app.invited_user_id;
  let inviteSent = false;
  let existingAccount = false;
  let inviteError = null;

  try {
    const existing = await findProfileByEmail(app.email);

    if (existing?.id) {
      userId = existing.id;
      existingAccount = true;
      await syncProfileAfterInvite(userId, app, preferredTier, { comp });
    } else {
      const { data: invited, error: inviteErr } = await supabase.auth.admin.inviteUserByEmail(app.email, {
        data: {
          full_name: app.full_name,
          network_application_id: app.id,
          applicant_type: app.applicant_type,
          preferred_membership_tier: preferredTier,
        },
        redirectTo: inviteRedirectUrl(),
      });

      if (inviteErr) {
        const again = await findProfileByEmail(app.email);
        if (again?.id) {
          userId = again.id;
          existingAccount = true;
          await syncProfileAfterInvite(userId, app, preferredTier, { comp });
        } else {
          throw new Error(inviteErr.message);
        }
      } else {
        userId = invited?.user?.id;
        inviteSent = true;
        for (let i = 0; i < 5 && userId; i += 1) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('id')
            .eq('id', userId)
            .maybeSingle();
          if (profile?.id) break;
          await new Promise((r) => setTimeout(r, 200));
        }
        if (userId) await syncProfileAfterInvite(userId, app, preferredTier, { comp });
      }
    }
  } catch (err) {
    inviteError = err.message || String(err);
    await supabase
      .from('network_applications')
      .update({
        invite_error: inviteError,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id);

    return res.status(400).json({
      error: `Invite failed: ${inviteError}`,
      hint: 'Check Supabase Auth email settings and that the Service Role key is configured.',
    });
  }

  const updates = {
    status: 'approved',
    granted_tier: preferredTier,
    invited_user_id: userId || null,
    invited_at: new Date().toISOString(),
    invite_error: null,
    updated_at: new Date().toISOString(),
  };
  if (notes !== undefined) updates.notes = notes;
  else if (app.applicant_type === 'partner' && !app.notes) {
    updates.notes = 'Partner applicant — invited; business listing still needs separate onboarding.';
  }
  if (comp) {
    updates.notes = [updates.notes, app.notes, 'Complimentary membership granted (no Stripe).']
      .filter(Boolean)
      .join(' ');
  }

  const { data: updated, error: updateError } = await supabase
    .from('network_applications')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (updateError) return res.status(400).json({ error: updateError.message });

  const payHint =
    preferredTier === 'free'
      ? 'They stay on Free in the app.'
      : comp
        ? `Complimentary ${preferredTier} granted.`
        : `They stay on Free until they pay for ${preferredTier} in the app (Subscribe).`;

  res.json({
    application: updated,
    invite_sent: inviteSent,
    existing_account: existingAccount,
    preferred_tier: preferredTier,
    complimentary: comp,
    granted_tier: preferredTier,
    message: inviteSent
      ? `Approved. Invite email sent. ${payHint}`
      : existingAccount
        ? `Approved. Existing account updated. ${payHint}`
        : `Approved. ${payHint}`,
  });
}

async function reject(req, res) {
  const { id } = req.params;
  const { notes, reason } = req.body || {};
  const noteText = notes ?? reason ?? null;

  const { data: app, error: fetchError } = await supabase
    .from('network_applications')
    .select('id, status')
    .eq('id', id)
    .single();

  if (fetchError || !app) return res.status(404).json({ error: 'Application not found' });

  const updates = {
    status: 'rejected',
    updated_at: new Date().toISOString(),
  };
  if (noteText != null) updates.notes = String(noteText);

  const { data, error } = await supabase
    .from('network_applications')
    .update(updates)
    .eq('id', id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
}

module.exports = {
  apply,
  list,
  updateStatus,
  approve,
  reject,
  suggestTier,
};
