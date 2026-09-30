const TERMS_VERSION = '2026-09-30';

function termsAcceptanceFields() {
  return { terms_accepted_at: new Date().toISOString(), terms_version: TERMS_VERSION };
}

function isMissingTermsColumn(error) {
  return !!error && (error.code === '42703' || /terms_/.test(error.message || ''));
}

/**
 * Runs a profiles/businesses write, retrying once without the terms columns
 * so sign-ups keep working on databases that haven't applied migration 040.
 */
async function writeWithTermsFallback(write, row) {
  const result = await write(row);
  if (!isMissingTermsColumn(result.error) || !('terms_accepted_at' in row)) return result;
  const { terms_accepted_at: _at, terms_version: _version, ...rest } = row;
  return write(rest);
}

module.exports = { termsAcceptanceFields, writeWithTermsFallback };
