-- Markets / locations for expansion
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

-- Ambassador rewards ledger
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
