-- Link Network website approvals to invited app accounts

ALTER TABLE network_applications
  ADD COLUMN IF NOT EXISTS invited_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invite_error TEXT,
  ADD COLUMN IF NOT EXISTS granted_tier membership_tier;

CREATE INDEX IF NOT EXISTS idx_network_applications_invited_user
  ON network_applications (invited_user_id)
  WHERE invited_user_id IS NOT NULL;
