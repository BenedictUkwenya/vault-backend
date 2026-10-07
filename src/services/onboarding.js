const supabase = require('../config/supabase');
const logger = require('../config/logger');

const CHECK_TYPES = ['identity', 'ownership', 'credential', 'portfolio'];

const BADGE_LABEL = {
  identity: 'Identity verified',
  ownership: 'Business ownership verified',
  credential: 'Professional license verified',
  portfolio: 'Additional work review',
};

const BADGE_DETAIL = {
  identity:
    'This confirms the person matches a government photo ID. It does not confirm qualifications, service quality, or a background check.',
  ownership: 'This confirms authority to operate the listed business. It does not confirm service quality.',
  credential: 'This confirms the named credential was checked with the source recorded by the reviewer.',
  portfolio: 'This confirms an extra review of work samples or references. It is not a quality guarantee.',
};

function badgeFrom(row) {
  const when = row.reviewed_at ? new Date(row.reviewed_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : null;
  return {
    check_type: row.check_type,
    label: BADGE_LABEL[row.check_type] || 'Verified',
    detail: [BADGE_DETAIL[row.check_type], row.result_note, when ? `Checked ${when}.` : null].filter(Boolean).join(' '),
    reviewed_at: row.reviewed_at || null,
  };
}

async function publicBadges(entityType, entityId) {
  const { data, error } = await supabase
    .from('verification_checks')
    .select('check_type, status, reviewed_at, result_note, expires_at')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('status', 'completed');
  if (error) return [];
  const now = Date.now();
  return (data || [])
    .filter((row) => !row.expires_at || new Date(row.expires_at).getTime() > now)
    .map(badgeFrom);
}

async function categoryBlock({ appliesTo, categoryName, entityType, entityId }) {
  const name = String(categoryName || '').trim();
  if (!name) return null;
  const { data, error } = await supabase
    .from('service_category_rules')
    .select('category_name, applies_to, requires_credential, credential_name')
    .ilike('category_name', name);
  if (error) {
    if (error.code !== '42P01') logger.warn('category rules unavailable', { message: error.message });
    return null;
  }
  const rule = (data || []).find(
    (row) => row.requires_credential && (row.applies_to === appliesTo || row.applies_to === 'both')
  );
  if (!rule) return null;
  const { data: check } = await supabase
    .from('verification_checks')
    .select('status, expires_at')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .eq('check_type', 'credential')
    .eq('status', 'completed')
    .maybeSingle();
  if (check && (!check.expires_at || new Date(check.expires_at).getTime() > Date.now())) return null;
  const label = rule.credential_name || 'a required license or permit';
  return `This category requires ${label} before the offering can go live. Record that check first. It is separate from optional badges.`;
}

module.exports = { CHECK_TYPES, BADGE_LABEL, publicBadges, categoryBlock };
