-- The live DB was created from an older schema. This adds everything missing
-- (includes 002 + 003 in case they were never run — all statements are idempotent).

-- CRITICAL: verify/one-time-redemption flow depends on this column
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- From 002
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_token TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN NOT NULL DEFAULT FALSE;
CREATE INDEX IF NOT EXISTS idx_businesses_featured ON businesses(is_featured) WHERE is_featured = TRUE;

-- From 003
CREATE TABLE IF NOT EXISTS markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  is_launched BOOLEAN NOT NULL DEFAULT FALSE,
  waitlist_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(city, state, country)
);

CREATE TABLE IF NOT EXISTS ambassador_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount NUMERIC(10,2) NOT NULL DEFAULT 0,
  reward_type TEXT NOT NULL DEFAULT 'referral',
  status TEXT NOT NULL DEFAULT 'pending',
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_ambassador_rewards_user ON ambassador_rewards(user_id);
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS last_streak_at TIMESTAMPTZ;

-- Clean up duplicate pending redemptions created while the verified_at check
-- was silently failing: keep only the newest per (user, deal).
DELETE FROM redemptions r
USING redemptions newer
WHERE r.user_id = newer.user_id
  AND r.deal_id = newer.deal_id
  AND r.redeemed_at < newer.redeemed_at;
