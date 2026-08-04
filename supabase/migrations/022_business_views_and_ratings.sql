-- Reset inflated view counts and add per-user business ratings

-- 1) Clear view counters
UPDATE businesses SET view_count = 0;
TRUNCATE business_views;

-- Drop old overload(s) so only the new signature remains
DROP FUNCTION IF EXISTS increment_business_views(UUID);

-- Keep businesses.view_count in sync when views increment; return new total
CREATE OR REPLACE FUNCTION increment_business_views(p_business_id UUID)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
DECLARE
  new_count BIGINT;
BEGIN
  INSERT INTO business_views (business_id, count)
  VALUES (p_business_id, 1)
  ON CONFLICT (business_id) DO UPDATE
  SET count = business_views.count + 1,
      updated_at = NOW()
  RETURNING count INTO new_count;

  UPDATE businesses
  SET view_count = new_count,
      updated_at = NOW()
  WHERE id = p_business_id;

  RETURN COALESCE(new_count, 1);
END;
$$;

-- 2) Member ratings for businesses (1–5 stars, one per user)
CREATE TABLE IF NOT EXISTS business_ratings (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_business_ratings_business
  ON business_ratings(business_id);

CREATE OR REPLACE FUNCTION refresh_business_rating_avg(p_business_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  UPDATE businesses b
  SET rating_avg = COALESCE((
    SELECT ROUND(AVG(r.rating)::numeric, 2)
    FROM business_ratings r
    WHERE r.business_id = p_business_id
  ), 0),
  updated_at = NOW()
  WHERE b.id = p_business_id;
END;
$$;

-- Prefer live business_views counter (ignore stale businesses.view_count fallback)
-- Must DROP first: CREATE OR REPLACE cannot reorder/rename columns when b.* shifts
DROP VIEW IF EXISTS businesses_with_stats;
CREATE VIEW businesses_with_stats AS
SELECT
  b.*,
  c.name  AS category_name,
  c.icon  AS category_icon,
  c.color AS category_color,
  COALESCE(d.active_deals_count, 0) AS active_deals_count,
  COALESCE(bv.count, 0) AS total_views
FROM businesses b
LEFT JOIN categories c ON b.category_id = c.id
LEFT JOIN (
  SELECT business_id, COUNT(*) AS active_deals_count
  FROM deals
  WHERE is_active = TRUE AND end_date > NOW()
  GROUP BY business_id
) d ON b.id = d.business_id
LEFT JOIN business_views bv ON b.id = bv.business_id;
