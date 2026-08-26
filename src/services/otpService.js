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

  const hash = emailService.hashOtpCode(codeNorm);
  if (hash !== row.code_hash) {
    await supabase
      .from('email_otps')
      .update({ attempts: (row.attempts || 0) + 1 })
      .eq('id', row.id);
    return { ok: false, error: 'Invalid code' };
  }

  await supabase
    .from('email_otps')
    .update({ consumed_at: new Date().toISOString() })
    .eq('id', row.id);

  return { ok: true };
}

module.exports = { issueOtp, verifyOtp, OTP_TTL_MS, MAX_ATTEMPTS };
