const { validationResult } = require('express-validator');
const supabase = require('../config/supabase');
const referralService = require('../services/referralService');
const emailService = require('../services/emailService');
const otpService = require('../services/otpService');
const logger = require('../config/logger');

async function findAuthUserIdByEmail(email) {
  const emailNorm = String(email || '').trim().toLowerCase();
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, email')
    .ilike('email', emailNorm)
    .maybeSingle();
  return profile?.id || null;
}

async function register(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { email, password, full_name, referral_code } = req.body;
  const emailNorm = String(email).trim().toLowerCase();

  const { data, error } = await supabase.auth.admin.createUser({
    email: emailNorm,
    password,
    email_confirm: false,
    user_metadata: { full_name },
  });

  if (error) return res.status(400).json({ error: error.message });

  const code = referralService.generateCode();
  await supabase
    .from('profiles')
    .update({ full_name, referral_code: code, email: emailNorm })
    .eq('id', data.user.id);

  if (referral_code) {
    await referralService.applyReferral(data.user.id, referral_code);
  }

  try {
    const { code: otp } = await otpService.issueOtp(emailNorm, 'signup_verify');
    await emailService.sendVerifyEmail(emailNorm, otp);
  } catch (err) {
    logger.error('register verify email failed', { email: emailNorm, message: err.message });
    return res.status(500).json({
      error: 'Account created but verification email failed. Use resend verification.',
      needs_verification: true,
      email: emailNorm,
    });
  }

  res.status(201).json({
    needs_verification: true,
    email: emailNorm,
    message: 'Check your email for a verification code.',
  });
}

async function verifyEmail(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const emailNorm = String(req.body.email).trim().toLowerCase();
  const { code, password } = req.body;

  const result = await otpService.verifyOtp(emailNorm, 'signup_verify', code);
  if (!result.ok) return res.status(400).json({ error: result.error });

  const userId = await findAuthUserIdByEmail(emailNorm);
  if (!userId) return res.status(404).json({ error: 'User not found' });

  const { error: confirmErr } = await supabase.auth.admin.updateUserById(userId, {
    email_confirm: true,
  });
  if (confirmErr) return res.status(400).json({ error: confirmErr.message });

  const { data: profile } = await supabase
    .from('profiles')
    .select('full_name')
    .eq('id', userId)
    .maybeSingle();

  try {
    await emailService.sendWelcomeEmail(emailNorm, profile?.full_name);
  } catch (err) {
    logger.warn('welcome email failed', { email: emailNorm, message: err.message });
  }

  const { data: session, error: signInErr } = await supabase.auth.signInWithPassword({
    email: emailNorm,
    password,
  });
  if (signInErr) {
    return res.status(400).json({
      error: signInErr.message,
      verified: true,
      message: 'Email verified. Please sign in with your password.',
    });
  }

  res.json({
    verified: true,
    user: session.user,
    session: session.session,
  });
}

async function resendVerify(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const emailNorm = String(req.body.email).trim().toLowerCase();
  const userId = await findAuthUserIdByEmail(emailNorm);
  // Always return success shape to avoid email enumeration
  if (!userId) {
    return res.json({ message: 'If that email needs verification, a new code was sent.' });
  }

  const { data: authData } = await supabase.auth.admin.getUserById(userId);
  if (authData?.user?.email_confirmed_at) {
    return res.json({ message: 'Email is already verified. You can sign in.' });
  }

  try {
    const { code } = await otpService.issueOtp(emailNorm, 'signup_verify');
    await emailService.sendVerifyEmail(emailNorm, code);
  } catch (err) {
    logger.error('resendVerify failed', { email: emailNorm, message: err.message });
    return res.status(500).json({ error: 'Could not send verification email' });
  }

  res.json({ message: 'If that email needs verification, a new code was sent.' });
}

async function login(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { email, password } = req.body;
  const emailNorm = String(email).trim().toLowerCase();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: emailNorm,
    password,
  });
  if (error) {
    // Hint unverified accounts
    if (/confirm|verified|email/i.test(error.message)) {
      return res.status(401).json({
        error: error.message,
        needs_verification: true,
        email: emailNorm,
      });
    }
    return res.status(401).json({ error: error.message });
  }

  res.json({ user: data.user, session: data.session });
}

async function logout(req, res) {
  await supabase.auth.admin.signOut(req.headers.authorization.split(' ')[1]);
  res.json({ message: 'Logged out' });
}

async function forgotPassword(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const emailNorm = String(req.body.email).trim().toLowerCase();
  const userId = await findAuthUserIdByEmail(emailNorm);

  if (userId) {
    try {
      const { code } = await otpService.issueOtp(emailNorm, 'password_reset');
      await emailService.sendPasswordResetCode(emailNorm, code);
    } catch (err) {
      logger.error('forgotPassword email failed', { email: emailNorm, message: err.message });
    }
  }

  res.json({ message: 'If an account exists for that email, a reset code was sent.' });
}

async function resetPasswordWithCode(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const emailNorm = String(req.body.email).trim().toLowerCase();
  const { code, new_password, password } = req.body;
  const newPassword = new_password || password;
  if (!newPassword || String(newPassword).length < 8) {
    return res.status(422).json({ error: 'new_password must be at least 8 characters' });
  }

  let verified = await otpService.verifyOtp(emailNorm, 'password_reset', code);
  if (!verified.ok) {
    verified = await otpService.verifyOtp(emailNorm, 'invite_set_password', code);
  }
  if (!verified.ok) return res.status(400).json({ error: verified.error });

  const userId = await findAuthUserIdByEmail(emailNorm);
  if (!userId) return res.status(404).json({ error: 'User not found' });

  const { error } = await supabase.auth.admin.updateUserById(userId, {
    password: newPassword,
    email_confirm: true,
  });
  if (error) return res.status(400).json({ error: error.message });

  try {
    await emailService.sendPasswordChangedEmail(emailNorm);
  } catch (err) {
    logger.warn('password changed email failed', { message: err.message });
  }

  res.json({ message: 'Password updated. You can sign in.' });
}

async function resetPassword(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  if (!req.user?.id) return res.status(401).json({ error: 'Not authenticated' });

  const { password } = req.body;

  const { error } = await supabase.auth.admin.updateUserById(req.user.id, {
    password,
  });
  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: 'Password updated' });
}

async function getMe(req, res) {
  const { data: profile } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', req.user.id)
    .single();

  res.json({ user: req.user, profile });
}

module.exports = {
  register,
  verifyEmail,
  resendVerify,
  login,
  logout,
  forgotPassword,
  resetPasswordWithCode,
  resetPassword,
  getMe,
};
