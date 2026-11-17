const supabase = require('../config/supabase');
const logger = require('../config/logger');
const notificationService = require('./notificationService');

const CAPACITY = 100;

const TABLE = {
  business: { table: 'businesses', owner: 'owner_id', flag: 'is_founding_member', number: 'founding_member_number', label: 'Founding Business', approved: (r) => r.review_status === 'approved' || r.is_approved },
  pro: { table: 'bl_pros', owner: 'user_id', flag: 'is_founding', number: 'founding_number', label: 'Founding BL Pro', approved: (r) => r.status === 'approved' },
};

async function nextNumber(cfg) {
  const { data } = await supabase.from(cfg.table).select(cfg.number).not(cfg.number, 'is', null);
  const used = new Set((data || []).map((r) => r[cfg.number]));
  for (let n = 1; n <= CAPACITY; n += 1) if (!used.has(n)) return n;
  return null;
}

/**
 * The Founding badge belongs to the first 100 paying subscribers of each provider plan,
 * not to everyone who is approved. Once earned it is kept permanently.
 */
async function grantFounding(type, ownerId) {
  const cfg = TABLE[type];
  if (!cfg || !ownerId) return null;
  const { data: row } = await supabase
    .from(cfg.table)
    .select(`id, name:${type === 'business' ? 'name' : 'display_name'}, ${cfg.flag}, ${cfg.number}, ${type === 'business' ? 'review_status, is_approved' : 'status'}`)
    .eq(cfg.owner, ownerId)
    .limit(1)
    .maybeSingle();
  if (!row || row[cfg.flag] || !cfg.approved(row)) return null;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const n = await nextNumber(cfg);
    if (!n) return null; // all 100 founding places are taken
    const { data: updated, error } = await supabase
      .from(cfg.table)
      .update({ [cfg.flag]: true, [cfg.number]: n })
      .eq('id', row.id)
      .or(`${cfg.flag}.is.null,${cfg.flag}.eq.false`)
      .select('id');
    if (error?.code === '23505') continue; // another subscriber took this number first
    if (error) {
      logger.warn({ message: 'founding grant failed', type, error: error.message });
      return null;
    }
    if (!updated?.length) return null; // already founding (e.g. a duplicate webhook)
    await notificationService
      .createNotification({
        userId: ownerId,
        title: `You’re ${cfg.label} #${n} 🎉`,
        body: `Thanks for subscribing. ${row.name || 'You'} now has the ${cfg.label} badge and a permanent place on the Founding Wall.`,
        type: 'system',
        data: { kind: type === 'business' ? 'business_founding' : 'pro_founding' },
      })
      .catch(() => null);
    return n;
  }
  return null;
}

module.exports = { grantFounding };
