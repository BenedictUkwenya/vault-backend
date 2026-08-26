-- Email OTP codes (Resend) + notification channel preferences

CREATE TABLE IF NOT EXISTS email_otps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT NOT NULL,
  purpose TEXT NOT NULL
    CHECK (purpose IN ('signup_verify', 'password_reset', 'invite_set_password')),
  code_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_otps_active
  ON email_otps (LOWER(email), purpose, created_at DESC)
  WHERE consumed_at IS NULL;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS email_notifications BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS push_notifications BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN profiles.email_notifications IS
  'When true, in-app notifications also send via Resend email';
COMMENT ON COLUMN profiles.push_notifications IS
  'When true, in-app notifications also send via Expo push';
