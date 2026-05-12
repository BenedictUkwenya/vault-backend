const supabase = require('../config/supabase');

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
  next();
}

/**
 * Requires the authenticated user to have the admin role stored in
 * user_metadata or the profiles table.
 */
async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', req.user.id)
    .single();

  if (!profile || profile.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }

  next();
}

/**
 * Requires the authenticated user to have an active paid membership.
 */
async function requirePaid(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Not authenticated' });

  const { data: profile } = await supabase
    .from('profiles')
    .select('membership_tier, membership_expires_at')
    .eq('id', req.user.id)
    .single();

  const isPaid =
    profile?.membership_tier === 'paid' &&
    (!profile.membership_expires_at ||
      new Date(profile.membership_expires_at) > new Date());

  if (!isPaid) {
    return res.status(403).json({ error: 'Paid membership required' });
  }

  next();
}

module.exports = { authenticate, requireAdmin, requirePaid };
