const supabase = require('../config/supabase');

const SUPER_ADMIN = 'super_admin';

function isSuperAdmin(profile) {
  return profile?.role === SUPER_ADMIN;
}

function hasAnyRole(profile, roles) {
  if (!profile) return false;
  if (isSuperAdmin(profile)) return true;
  return roles.includes(profile.role);
}

/**
 * Validates the Supabase JWT in the Authorization header and attaches
 * the user object to req.user.
 */
async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.split(' ')[1];

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data.user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = data.user;
  const { data: profile } = await supabase
    .from('profiles')
    .select('role, membership_tier, membership_expires_at, referral_code, is_banned')
    .eq('id', data.user.id)
    .single();

  if (profile?.is_banned) {
    return res.status(403).json({ error: 'Account disabled' });
  }

  req.profile = profile || null;
  next();
}

/**
 * Requires the authenticated user to have one of the provided profile roles.
 * super_admin bypasses all role checks.
 */
function requireRole(roles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Not authenticated' });
    if (!hasAnyRole(req.profile, roles)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
}

async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  if (!hasAnyRole(req.profile, ['admin'])) {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}

function requireBusiness(req, res, next) {
  return requireRole(['business', 'admin'])(req, res, next);
}

function requireAmbassador(req, res, next) {
  return requireRole(['ambassador', 'admin'])(req, res, next);
}

/**
 * Requires the authenticated user to have an active paid membership.
 */
async function requirePaid(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  const isPaid =
    req.profile?.membership_tier === 'paid' &&
    (!req.profile.membership_expires_at ||
      new Date(req.profile.membership_expires_at) > new Date());

  if (!isPaid) {
    return res.status(403).json({ error: 'Paid membership required' });
  }

  next();
}

module.exports = {
  authenticate,
  requireRole,
  requireAdmin,
  requireBusiness,
  requireAmbassador,
  requirePaid,
  isSuperAdmin,
};
