const supabase = require('../config/supabase');

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

/** ILIKE pattern that matches the literal string only (no `%` / `_` wildcards). */
function literalIlikePattern(value) {
  return String(value).replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * Case-insensitive exact email match. Never use a raw `.ilike('email', input)`:
 * `_` and `%` in the input act as wildcards and can match someone else's account.
 */
async function findProfileByEmail(email, columns = 'id, email') {
  const emailNorm = normalizeEmail(email);
  if (!emailNorm) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select(columns.includes('email') ? columns : `${columns}, email`)
    .ilike('email', literalIlikePattern(emailNorm))
    .limit(5);
  if (error || !data) return null;
  return data.find((row) => normalizeEmail(row.email) === emailNorm) || null;
}

async function findProfileIdByEmail(email) {
  const row = await findProfileByEmail(email, 'id, email');
  return row?.id || null;
}

module.exports = { normalizeEmail, literalIlikePattern, findProfileByEmail, findProfileIdByEmail };
