-- 044: Student email verification for the Student plan.
-- Keeps every existing OTP purpose (see 032) and adds student_verify.
ALTER TABLE email_otps
  DROP CONSTRAINT IF EXISTS email_otps_purpose_check;

ALTER TABLE email_otps
  ADD CONSTRAINT email_otps_purpose_check
  CHECK (purpose IN (
    'signup_verify',
    'password_reset',
    'invite_set_password',
    'admin_step_up',
    'student_verify'
  ));

-- The school email that verified the account. One school email per account.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS student_email TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_student_email_unique
  ON profiles (LOWER(student_email))
  WHERE student_email IS NOT NULL;
