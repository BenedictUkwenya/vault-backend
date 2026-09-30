const supabase = require('../config/supabase');
const logger = require('../config/logger');

const CHECKLISTS = {
  business: [
    { key: 'owner_identity', label: 'Owner identity confirmed' },
    { key: 'location', label: 'Address / location is real' },
    { key: 'contact', label: 'Phone or email works' },
    { key: 'listing_accurate', label: 'Listing and deals are accurate' },
    { key: 'photos', label: 'Photos are genuine and appropriate' },
    { key: 'standards', label: 'Meets Black Limitless quality standards' },
  ],
  pro: [
    { key: 'identity', label: 'Identity confirmed' },
    { key: 'credentials', label: 'Licenses / certifications checked' },
    { key: 'portfolio', label: 'Portfolio is their own work' },
    { key: 'services', label: 'Services match their proof' },
    { key: 'contact', label: 'Contact details work' },
    { key: 'standards', label: 'Meets Black Limitless quality standards' },
  ],
};

function normalizeChecklist(entityType, input) {
  const items = CHECKLISTS[entityType] || [];
  const source = input && typeof input === 'object' ? input : {};
  return Object.fromEntries(items.map((item) => [item.key, source[item.key] === true]));
}

function isComplete(entityType, checklist) {
  return (CHECKLISTS[entityType] || []).every((item) => checklist[item.key] === true);
}

/** Best-effort: a missing qa_reviews table must never block an approval. */
async function recordReview({ entityType, entityId, reviewerId, checklist, outcome, notes }) {
  const { error } = await supabase.from('qa_reviews').insert({
    entity_type: entityType,
    entity_id: entityId,
    reviewer_id: reviewerId || null,
    checklist: checklist || {},
    outcome,
    notes: notes ? String(notes).trim().slice(0, 1000) : null,
  });
  if (error) logger.warn('qa review not recorded', { entityType, entityId, error: error.message });
}

async function listReviews(entityType, entityId) {
  const { data, error } = await supabase
    .from('qa_reviews')
    .select('id, outcome, checklist, notes, created_at, reviewer:reviewer_id(full_name)')
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) {
    logger.warn('qa reviews unavailable', { error: error.message });
    return [];
  }
  return data || [];
}

module.exports = { CHECKLISTS, normalizeChecklist, isComplete, recordReview, listReviews };
