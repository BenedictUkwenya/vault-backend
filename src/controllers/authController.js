const { validationResult } = require('express-validator');
const supabase = require('../config/supabase');
const referralService = require('../services/referralService');
const emailService = require('../services/emailService');
const otpService = require('../services/otpService');
const logger = require('../config/logger');
const { findProfileIdByEmail: findAuthUserIdByEmail } = require('../utils/emailLookup');
const terms = require('../utils/termsAcceptance');
const { termsAcceptanceFields, writeWithTermsFallback } = terms;

async function register(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { email, password, full_name, referral_code, accepted_terms } = req.body;
  const emailNorm = String(email).trim().toLowerCase();

  const { data, error } = await supabase.auth.admin.createUser({
    email: emailNorm,
    password,
    email_confirm: false,
    user_metadata: { full_name },
  });

  if (error) return res.status(400).json({ error: error.message });

  const code = referralService.generateCode();
  await writeWithTermsFallback((row) => supabase.from('profiles').update(row).eq('id', data.user.id), {
    full_name,
    referral_code: code,
    email: emailNorm,
    ...(accepted_terms ? termsAcceptanceFields(terms.versionFor(req)) : {}),
  });

  if (accepted_terms && terms.clientOnCurrentAgreements(req)) {
    await terms.recordAcceptance(data.user.id, {
      agreementId: 'member',
      checkboxText: terms.CHECKBOX.member,
    });
  }

  if (referral_code) {
    const applied = await referralService.applyReferral(data.user.id, referral_code);
    if (applied.error) {
      // Soft fail: account exists; surface warning so client can show it
      try {
        const { code: otp } = await otpService.issueOtp(emailNorm, 'signup_verify');
        await emailService.sendVerifyEmail(emailNorm, otp);
      } catch (err) {
        logger.error('register verify email failed', { email: emailNorm, message: err.message });
        return res.status(500).json({
          error: 'Account created but verification email failed. Use resend verification.',
          needs_verification: true,
          email: emailNorm,
          referral_warning: applied.error,
        });
      }
      return res.status(201).json({
        needs_verification: true,
        email: emailNorm,
        message: 'Check your email for a verification code.',
        referral_warning: applied.error,
      });
    }
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
    // The code is already consumed and the email confirmed, so this is a success
    // the client should route to login rather than an error to retry.
    return res.json({
      verified: true,
      needs_login: true,
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

async function acceptAgreements(req, res) {
  const parts = Array.isArray(req.body.parts) ? req.body.parts.map(String) : [];
  if (!parts.length) return res.status(400).json({ error: 'Choose the agreements to accept.' });

  if (parts.includes('member')) {
    if (req.body.accepted_member !== true) {
      return res.status(400).json({ error: 'Please accept the Member and Platform Terms.' });
    }
    const updated = await writeWithTermsFallback(
      (row) => supabase.from('profiles').update(row).eq('id', req.user.id),
      termsAcceptanceFields(terms.TERMS_VERSION)
    );
    if (updated.error) return res.status(400).json({ error: updated.error.message });
    await terms.recordAcceptance(req.user.id, {
      agreementId: 'member',
      checkboxText: terms.CHECKBOX.member,
    });
  }

  if (parts.includes('business')) {
    if (req.body.accepted_provider !== true) {
      return res.status(400).json({ error: 'Please accept the Business and Provider Agreement.' });
    }
    const identity = terms.providerIdentity(req.body || {});
    if (identity.error) return res.status(400).json({ error: identity.error });
    const { data: business, error: lookupError } = await supabase
      .from('businesses')
      .select('id')
      .eq('owner_id', req.user.id)
      .order('created_at', { ascending: true })
      .limit(1)
      .maybeSingle();
    if (lookupError) return res.status(400).json({ error: lookupError.message });
    if (!business) return res.status(400).json({ error: 'Register a business before accepting the provider agreement.' });

    const updated = await writeWithTermsFallback(
      (row) => supabase.from('businesses').update(row).eq('id', business.id),
      {
        ...termsAcceptanceFields(terms.TERMS_VERSION),
        legal_name: identity.legal_name,
        entity_type: identity.entity_type,
        signer_name: identity.signer_name,
        signer_title: identity.signer_title,
      }
    );
    if (updated.error) return res.status(400).json({ error: updated.error.message });
    await terms.recordAcceptance(req.user.id, {
      agreementId: 'business',
      checkboxText: terms.CHECKBOX.business,
      signerName: identity.signer_name,
      providerLegalName: identity.legal_name,
      entityType: identity.entity_type,
      signerTitle: identity.signer_title,
    });
  }

  res.json({ terms_version: terms.TERMS_VERSION });
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
  acceptAgreements,
  getMe,
};
