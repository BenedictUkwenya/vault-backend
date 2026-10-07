const supabase = require('../config/supabase');
const logger = require('../config/logger');

const TERMS_VERSION = '0.2';
const LEGACY_TERMS_VERSION = '2026-09-30';

const CHECKBOX = {
  member: 'I am at least 18 and agree to the Member and Platform Terms.',
  business:
    'I am authorized to bind the Provider identified above and agree to the Business and Provider Agreement, including its fulfillment, refund and indemnity provisions.',
  pro: 'I also agree to the BL Pro Service Addendum and confirm that my service and qualification information is accurate.',
  offer: 'I confirm this offer is accurate and agree to honor it for eligible members under the displayed terms.',
};

function clientOnCurrentAgreements(req) {
  return String(req.get('x-agreement-version') || '') === TERMS_VERSION;
}

function versionFor(req) {
  return clientOnCurrentAgreements(req) ? TERMS_VERSION : LEGACY_TERMS_VERSION;
}

function termsAcceptanceFields(version = TERMS_VERSION) {
  return { terms_accepted_at: new Date().toISOString(), terms_version: version };
}

function isMissingTermsColumn(error) {
  return !!error && (error.code === '42703' || error.code === 'PGRST204' || /terms_/.test(error.message || ''));
}

function columnMissing(error, column) {
  if (!error) return false;
  const msg = error.message || '';
  return (
    (error.code === '42703' || error.code === 'PGRST204' || /column|schema cache/i.test(msg)) &&
    msg.includes(column)
  );
}

/**
 * Runs a write, dropping columns the database does not have yet.
 * Sign-up and applications keep working before migration 040/041.
 */
async function writeStripping(write, row) {
  let current = { ...row };
  for (let i = 0; i < 10; i += 1) {
    if (!Object.keys(current).length) return { data: null, error: null };
    const result = await write(current);
    if (!result.error) return result;
    const key = Object.keys(current).find((col) => columnMissing(result.error, col));
    if (!key) return result;
    const next = { ...current };
    delete next[key];
    current = next;
  }
  return write(current);
}

async function writeWithTermsFallback(write, row) {
  return writeStripping(write, row);
}

function cleanName(value, max = 120) {
  const s = String(value ?? '').trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : '';
}

function namesMatch(a, b) {
  return cleanName(a).toLowerCase().length > 1 && cleanName(a).toLowerCase() === cleanName(b).toLowerCase();
}

function providerIdentity(body) {
  const legal_name = cleanName(body.legal_name);
  const entity_type = cleanName(body.entity_type, 40);
  const signer_name = cleanName(body.signer_name);
  const signer_title = cleanName(body.signer_title, 80);
  if (legal_name.length < 2) return { error: 'Enter the Provider’s legal name.' };
  if (!entity_type) return { error: 'Select whether the Provider is a company or an individual.' };
  if (signer_name.length < 2) return { error: 'Enter the signer’s name.' };
  if (!signer_title) return { error: 'Enter the signer’s title.' };
  if (!namesMatch(body.signature, signer_name)) {
    return { error: 'Type your full name, matching the signer name, to sign.' };
  }
  return { legal_name, entity_type, signer_name, signer_title };
}

function utcChargeDate(extraDays) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + extraDays);
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function billingConsentText(priceLabel, extraDays, trialDays) {
  const money = String(priceLabel || '').replace('/mo', '').trim();
  const firstCharge = utcChargeDate(extraDays);
  const trial = trialDays
    ? ` The first ${trialDays} days are free and end ${firstCharge}; if I do not cancel before then, the monthly charge starts.`
    : '';
  return `I authorize Black Limitless LLC to charge ${money} plus applicable tax every month, beginning ${firstCharge}, until I cancel.${trial} I can cancel future renewals through Profile → Subscription, then Manage billing.`;
}

async function recordAcceptance(userId, fields) {
  const row = {
    user_id: userId,
    agreement_id: fields.agreementId,
    version: TERMS_VERSION,
    checkbox_text: fields.checkboxText,
    signer_name: fields.signerName || null,
    provider_legal_name: fields.providerLegalName || null,
    entity_type: fields.entityType || null,
    signer_title: fields.signerTitle || null,
    accepted_at: new Date().toISOString(),
  };
  const { error } = await supabase.from('agreement_acceptances').insert(row);
  if (error && (error.code === '42P01' || /agreement_acceptances/.test(error.message || ''))) {
    logger.warn('agreement_acceptances missing — apply migration 041');
    return;
  }
  if (error) logger.error('agreement acceptance log failed', { message: error.message, agreementId: fields.agreementId });
}

async function memberTermsCurrent(userId) {
  const { data, error } = await supabase.from('profiles').select('terms_version').eq('id', userId).maybeSingle();
  if (error && isMissingTermsColumn(error)) return true;
  return data?.terms_version === TERMS_VERSION;
}

async function providerTermsCurrent(businessId) {
  const { data, error } = await supabase.from('businesses').select('terms_version').eq('id', businessId).maybeSingle();
  if (error && isMissingTermsColumn(error)) return true;
  return data?.terms_version === TERMS_VERSION;
}

module.exports = {
  TERMS_VERSION,
  LEGACY_TERMS_VERSION,
  CHECKBOX,
  clientOnCurrentAgreements,
  versionFor,
  termsAcceptanceFields,
  isMissingTermsColumn,
  writeWithTermsFallback,
  writeStripping,
  providerIdentity,
  billingConsentText,
  recordAcceptance,
  memberTermsCurrent,
  providerTermsCurrent,
};
