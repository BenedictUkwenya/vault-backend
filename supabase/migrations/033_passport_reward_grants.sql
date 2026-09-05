-- Passport rewards beyond counters: claimable grants + redemption credits.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS passport_redemption_credits INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS passport_reward_grants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reward_key TEXT NOT NULL DEFAULT 'extra_redemption',
  title TEXT NOT NULL,
  description TEXT,
  stamp_threshold INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'available'
    CHECK (status IN ('available', 'claimed', 'expired')),
  unlocked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  claimed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, stamp_threshold, reward_key)
);

CREATE INDEX IF NOT EXISTS idx_passport_grants_user_status
  ON passport_reward_grants(user_id, status);

ALTER TABLE passport_reward_grants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own passport grants"
  ON passport_reward_grants FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access passport grants"
  ON passport_reward_grants
  USING (auth.role() = 'service_role');
