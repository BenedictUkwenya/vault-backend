const supabase = require('../config/supabase');

const PRIVILEGED_ROLES = new Set(['admin', 'super_admin']);

/**
 * If this user owns a business row, ensure their profile role is `business`.
 * Never demote admin / super_admin (they may own a test business).
 */
async function ensureBusinessRole(userId) {
  if (!userId) return;

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('id', userId)
    .maybeSingle();

  if (PRIVILEGED_ROLES.has(profile?.role)) return;

  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();
  if (!business) return;

  await supabase.from('profiles').update({ role: 'business' }).eq('id', userId);
}

module.exports = { ensureBusinessRole };
