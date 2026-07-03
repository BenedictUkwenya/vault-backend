const { validationResult } = require('express-validator');
const supabase = require('../config/supabase');
const referralService = require('../services/referralService');

async function register(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { email, password, full_name, referral_code } = req.body;

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name },
  });

  if (error) return res.status(400).json({ error: error.message });

  // Profile is created by DB trigger, but set referral code
  const code = referralService.generateCode();
  await supabase
    .from('profiles')
    .update({ full_name, referral_code: code })
    .eq('id', data.user.id);

  // Apply referral if provided
  if (referral_code) {
    await referralService.applyReferral(data.user.id, referral_code);
  }

  // Sign in to get a token
  const { data: session, error: signInErr } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (signInErr) return res.status(400).json({ error: signInErr.message });

  res.status(201).json({
    user: session.user,
    session: session.session,
  });
}

async function login(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { email, password } = req.body;

  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return res.status(401).json({ error: error.message });

  res.json({ user: data.user, session: data.session });
}

async function logout(req, res) {
  await supabase.auth.admin.signOut(
    req.headers.authorization.split(' ')[1]
  );
  res.json({ message: 'Logged out' });
}

async function forgotPassword(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) return res.status(422).json({ errors: errors.array() });

  const { email } = req.body;
  const { error } = await supabase.auth.resetPasswordForEmail(email);
  if (error) return res.status(400).json({ error: error.message });

  res.json({ message: 'Password reset email sent' });
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

module.exports = { register, login, logout, forgotPassword, resetPassword, getMe };
