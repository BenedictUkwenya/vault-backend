-- Referral milestone rewards: each event pays once per invitee

ALTER TABLE ambassador_rewards
  ADD COLUMN IF NOT EXISTS referred_user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS event_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ambassador_rewards_unique_event
  ON ambassador_rewards (user_id, referred_user_id, event_key)
  WHERE referred_user_id IS NOT NULL AND event_key IS NOT NULL;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ambassador_unlocked_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_profiles_ambassador_unlocked
  ON profiles (ambassador_unlocked_at)
  WHERE ambassador_unlocked_at IS NOT NULL;
