-- Wire waitlist entries and member profiles to markets (city rollout)

ALTER TABLE waitlist
  ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS market_id UUID REFERENCES markets(id) ON DELETE SET NULL;

-- One waitlist signup per email per market
ALTER TABLE waitlist DROP CONSTRAINT IF EXISTS waitlist_email_key;
CREATE UNIQUE INDEX IF NOT EXISTS idx_waitlist_email_market
  ON waitlist (LOWER(email), market_id);

CREATE INDEX IF NOT EXISTS idx_waitlist_market ON waitlist (market_id);
CREATE INDEX IF NOT EXISTS idx_profiles_market ON profiles (market_id);

COMMENT ON COLUMN profiles.market_id IS 'Member home market — set when city matches a market row';
COMMENT ON COLUMN waitlist.market_id IS 'Which market/city rollout this signup is for';
