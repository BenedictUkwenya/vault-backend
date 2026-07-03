const supabase = require('../config/supabase');

/** If this user owns a business row, ensure their profile role is `business`. */
async function ensureBusinessRole(userId) {
  if (!userId) return;
  const { data: business } = await supabase
    .from('businesses')
    .select('id')
    .eq('owner_id', userId)
    .maybeSingle();
  if (!business) return;
  await supabase.from('profiles').update({ role: 'business' }).eq('id', userId);
}

module.exports = { ensureBusinessRole };
