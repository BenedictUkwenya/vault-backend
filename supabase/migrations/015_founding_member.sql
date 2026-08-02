-- Black Limitless Founding Member (first 100 approved businesses)
ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS is_founding_member BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS founding_member_number INT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_founding_number
  ON businesses(founding_member_number)
  WHERE founding_member_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_founding
  ON businesses(is_founding_member)
  WHERE is_founding_member = TRUE;

-- Backfill: oldest approved businesses get numbers 1..100
WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM businesses
  WHERE is_approved = TRUE
    AND is_founding_member = FALSE
    AND founding_member_number IS NULL
)
UPDATE businesses b
SET
  is_founding_member = TRUE,
  founding_member_number = ranked.rn,
  updated_at = NOW()
FROM ranked
WHERE b.id = ranked.id
  AND ranked.rn <= 100
  AND NOT EXISTS (
    SELECT 1 FROM businesses x WHERE x.founding_member_number = ranked.rn
  );
