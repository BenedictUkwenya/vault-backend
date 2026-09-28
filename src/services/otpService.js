const supabase = require('../config/supabase');
const emailService = require('./emailService');
const logger = require('../config/logger');

const OTP_TTL_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 5;

/**
 * Invalidate prior unused codes and create a new OTP for email+purpose.
 * Returns the plaintext code (for emailing).
 */
async function issueOtp(email, purpose) {
  const emailNorm = String(email || '').trim().toLowerCase();
  if (!emailNorm || !purpose) throw new Error('email and purpose are required');

  const code = emailService.generateOtpCode();
  const code_hash = emailService.hashOtpCode(code);
  const expires_at = new Date(Date.now() + OTP_TTL_MS).toISOString();

  // Invalidate previous unused codes
  await supabase
    .from('email_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('email', emailNorm)
    .eq('purpose', purpose)
    .is('consumed_at', null);

  const { error } = await supabase.from('email_otps').insert({
    email: emailNorm,
    purpose,
    code_hash,
    expires_at,
  });

  if (error) {
    logger.error('issueOtp insert failed', { error: error.message });
    throw new Error(error.message);
  }

  return { code, email: emailNorm, expires_at };
}

/**
 * Verify OTP. Returns { ok: true } or { ok: false, error }.
 * Consumes the code on success.
 */
async function verifyOtp(email, purpose, code) {
  const emailNorm = String(email || '').trim().toLowerCase();
  const codeNorm = String(code || '').trim();
  if (!emailNorm || !purpose || !codeNorm) {
    return { ok: false, error: 'Invalid code' };
  }

  const { data: rows, error } = await supabase
    .from('email_otps')
    .select('*')
    .eq('email', emailNorm)
    .eq('purpose', purpose)
    .is('consumed_at', null)
    .order('created_at', { ascending: false })
    .limit(1);

  if (error) return { ok: false, error: error.message };
  const row = rows?.[0];
  if (!row) return { ok: false, error: 'No active code. Request a new one.' };

  if (new Date(row.expires_at) < new Date()) {
    await supabase.from('email_otps').update({ consumed_at: new Date().toISOString() }).eq('id', row.id);
    return { ok: false, error: 'Code expired. Request a new one.' };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await supabase.from('email_otps').update({ consumed_at: new Date().toISOString() }).eq('id', row.id);
    return { ok: false, error: 'Too many attempts. Request a new code.' };
  }

  // Reserve an attempt before comparing, conditioned on the count we read, so
  // parallel guesses can't all slip under MAX_ATTEMPTS.
  const attempts = row.attempts || 0;
  const { data: reserved } = await supabase
    .from('email_otps')
    .update({ attempts: attempts + 1 })
    .eq('id', row.id)
    .eq('attempts', attempts)
    .is('consumed_at', null)
    .select('id');
  if (!reserved?.length) return { ok: false, error: 'Invalid code' };

  const matches =
    emailService.hashOtpCode(codeNorm) === row.code_hash ||
    emailService.legacyHashOtpCode(codeNorm) === row.code_hash;
  if (!matches) return { ok: false, error: 'Invalid code' };

  const { data: consumed } = await supabase
    .from('email_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id)
    .is('consumed_at', null)
    .select('id');
  if (!consumed?.length) return { ok: false, error: 'Code already used. Request a new one.' };

  return { ok: true };
}

module.exports = { issueOtp, verifyOtp, OTP_TTL_MS, MAX_ATTEMPTS };
