-- Business profile completeness: location, contact, socials, gallery posts

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS country TEXT DEFAULT 'United States';

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS email TEXT;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS instagram_handle TEXT;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS facebook_handle TEXT;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS tiktok_handle TEXT;

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS twitter_handle TEXT;

-- Owner-published posts (media / updates on business profile)
CREATE TABLE IF NOT EXISTS business_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  caption TEXT,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_business_posts_business
  ON business_posts(business_id, created_at DESC);
