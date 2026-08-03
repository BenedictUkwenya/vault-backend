-- Membership v1: Free / Student / Member / VIP + Passport stub + deal VIP flags

-- Convert membership_tier enum free|paid → free|student|member|vip
ALTER TABLE profiles ALTER COLUMN membership_tier DROP DEFAULT;
ALTER TABLE profiles
  ALTER COLUMN membership_tier TYPE TEXT
  USING membership_tier::text;

UPDATE profiles SET membership_tier = 'member' WHERE membership_tier = 'paid';

DROP TYPE IF EXISTS membership_tier;
CREATE TYPE membership_tier AS ENUM ('free', 'student', 'member', 'vip');

ALTER TABLE profiles
  ALTER COLUMN membership_tier TYPE membership_tier
  USING membership_tier::membership_tier;

ALTER TABLE profiles
  ALTER COLUMN membership_tier SET DEFAULT 'free'::membership_tier;

-- Student verification (manual / future ID check)
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS student_verified_at TIMESTAMPTZ;

-- VIP-only deals (higher tier than standard paid)
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS requires_vip_tier BOOLEAN NOT NULL DEFAULT FALSE;

-- Passport progress (stub for v1 — stamps from verified redemptions / visits)
CREATE TABLE IF NOT EXISTS passport_progress (
  user_id UUID PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  stamps_count INT NOT NULL DEFAULT 0,
  last_stamp_at TIMESTAMPTZ,
  rewards_unlocked INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_passport_stamps ON passport_progress(stamps_count DESC);

-- Business subscription tracking (Founding Business $25/mo)
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS subscription_status TEXT DEFAULT 'none';
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS subscription_expires_at TIMESTAMPTZ;
