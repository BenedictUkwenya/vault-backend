-- Add columns for push notifications, featured businesses, fraud flags
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS push_token TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS is_featured BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE redemptions ADD COLUMN IF NOT EXISTS is_flagged BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_businesses_featured ON businesses(is_featured) WHERE is_featured = TRUE;
