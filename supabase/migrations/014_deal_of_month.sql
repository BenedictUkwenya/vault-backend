-- Deals of the Month curation flag (optional; API falls back to popular if unused)
ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS is_deal_of_month BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_deals_dom ON deals(is_deal_of_month);

-- Expose on deals_with_business view if it selects deals.* already — no change needed.
-- If your view lists columns explicitly, re-run the view definition from schema.sql after this.
