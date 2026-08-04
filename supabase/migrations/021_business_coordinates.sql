-- Business map coordinates for directions / map pin
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

CREATE INDEX IF NOT EXISTS idx_businesses_coords
  ON businesses(latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;
