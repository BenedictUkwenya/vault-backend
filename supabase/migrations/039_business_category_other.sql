-- 039: "Other" business category with a free-text description.

INSERT INTO categories (name, icon, color, sort_order)
VALUES ('Other', '✨', '#98A2B3', 999)
ON CONFLICT (name) DO NOTHING;

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS category_other TEXT;

-- b.* is expanded when a view is created, so the view must be rebuilt to pick up
-- category_other. "Other" businesses show their own description as the category.
DROP VIEW IF EXISTS businesses_with_stats;
CREATE VIEW businesses_with_stats WITH (security_invoker = true) AS
SELECT
  b.*,
  CASE
    WHEN c.name = 'Other' AND COALESCE(TRIM(b.category_other), '') <> '' THEN TRIM(b.category_other)
    ELSE c.name
  END AS category_name,
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

GRANT SELECT ON businesses_with_stats TO anon, authenticated;
