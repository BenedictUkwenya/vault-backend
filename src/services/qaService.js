const supabase = require('../config/supabase');
const logger = require('../config/logger');

const CHECKLISTS = {
  business: [
    { key: 'consistent', label: 'Name, contact, category and description are consistent' },
    { key: 'evidence', label: 'One credible source shows the business operates' },
    { key: 'offer', label: 'The member offer is clear, or they can publish one after approval' },
  ],
  pro: [
    { key: 'person', label: 'The person delivering the service is named' },
    { key: 'evidence', label: 'One credible example, qualification or reference is present' },
    { key: 'offer', label: 'The service description is clear' },
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
