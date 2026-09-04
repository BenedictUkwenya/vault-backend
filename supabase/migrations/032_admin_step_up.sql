-- Admin step-up OTPs + short-lived action sessions

ALTER TABLE email_otps
  DROP CONSTRAINT IF EXISTS email_otps_purpose_check;

ALTER TABLE email_otps
  ADD CONSTRAINT email_otps_purpose_check
  CHECK (purpose IN (
    'signup_verify',
    'password_reset',
    'invite_set_password',
    'admin_step_up'
  ));

CREATE TABLE IF NOT EXISTS admin_action_sessions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  admin_user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_admin_action_sessions_admin
  ON admin_action_sessions (admin_user_id, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_action_sessions_hash
  ON admin_action_sessions (token_hash);
