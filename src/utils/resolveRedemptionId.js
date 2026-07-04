const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function normalizeSuffix(input) {
  return String(input).trim().replace(/-/g, '').toLowerCase();
}

/** Resolve full redemption UUID from QR data or short member code (last 8 chars). */
async function resolveRedemptionId(supabase, input, businessId) {
  const raw = String(input ?? '').trim();
  if (!raw) return null;

  if (UUID_RE.test(raw)) return raw.toLowerCase();

  const suffix = normalizeSuffix(raw);
  if (!/^[0-9a-f]{6,32}$/.test(suffix)) return raw;

  const needle = suffix.length > 8 ? suffix.slice(-8) : suffix;

  const { data, error } = await supabase
    .from('redemptions')
    .select('id')
    .eq('business_id', businessId)
    .order('redeemed_at', { ascending: false })
    .limit(200);

  if (error) throw error;

  const matches = (data ?? []).filter((row) => row.id.replace(/-/g, '').toLowerCase().endsWith(needle));
  if (matches.length === 1) return matches[0].id;
  if (matches.length > 1) {
    throw new Error('Multiple redemptions match that code — scan the full QR instead');
  }
  return null;
}

module.exports = { resolveRedemptionId };
