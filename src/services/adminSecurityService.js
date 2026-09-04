const crypto = require('crypto');
const supabase = require('../config/supabase');
const otpService = require('./otpService');
const emailService = require('./emailService');
const logger = require('../config/logger');

const PURPOSE = 'admin_step_up';
const SESSION_TTL_MS = 30 * 60 * 1000; // 30 minutes

function hashToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

function newSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

async function requestChallenge(adminUser) {
  const email = String(adminUser.email || '').trim().toLowerCase();
  if (!email) throw new Error('Admin account has no email for verification');

  const { code } = await otpService.issueOtp(email, PURPOSE);
  await emailService.sendAdminStepUpEmail(email, code);
  return { email, expires_in_seconds: Math.floor(otpService.OTP_TTL_MS / 1000) };
}

async function verifyChallenge(adminUser, code) {
  const email = String(adminUser.email || '').trim().toLowerCase();
  if (!email) return { ok: false, error: 'Admin account has no email' };

  const result = await otpService.verifyOtp(email, PURPOSE, code);
  if (!result.ok) return result;

  // Invalidate prior sessions for this admin
  await supabase
    .from('admin_action_sessions')
    .delete()
    .eq('admin_user_id', adminUser.id)
    .lt('expires_at', new Date(Date.now() + SESSION_TTL_MS * 2).toISOString());

  await supabase.from('admin_action_sessions').delete().eq('admin_user_id', adminUser.id);

  const token = newSessionToken();
  const expires_at = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  const { error } = await supabase.from('admin_action_sessions').insert({
    admin_user_id: adminUser.id,
    token_hash: hashToken(token),
    expires_at,
  });

  if (error) {
    logger.error('admin session create failed', { error: error.message });
    return { ok: false, error: error.message };
  }

  return {
    ok: true,
    action_token: token,
    expires_at,
    expires_in_seconds: Math.floor(SESSION_TTL_MS / 1000),
  };
}

async function validateSession(adminUserId, token) {
  if (!adminUserId || !token) return false;
  const token_hash = hashToken(token);
  const { data } = await supabase
    .from('admin_action_sessions')
    .select('id, expires_at')
    .eq('admin_user_id', adminUserId)
    .eq('token_hash', token_hash)
    .maybeSingle();

  if (!data) return false;
  if (new Date(data.expires_at) < new Date()) {
    await supabase.from('admin_action_sessions').delete().eq('id', data.id);
    return false;
  }
  return true;
}

async function sessionStatus(adminUserId, token) {
  const valid = await validateSession(adminUserId, token);
  return { verified: valid };
}

async function revokeSessions(adminUserId) {
  await supabase.from('admin_action_sessions').delete().eq('admin_user_id', adminUserId);
}

module.exports = {
  PURPOSE,
  SESSION_TTL_MS,
  requestChallenge,
  verifyChallenge,
  validateSession,
  sessionStatus,
  revokeSessions,
};
