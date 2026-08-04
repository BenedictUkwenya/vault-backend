-- Backfill Founding Member for approved businesses that are Live but missing the badge.
-- Safe to re-run: only touches rows that are approved and not yet founding.

WITH ranked AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn
  FROM businesses
  WHERE is_approved = TRUE
    AND (is_founding_member = FALSE OR founding_member_number IS NULL)
),
offset_base AS (
  SELECT COALESCE(MAX(founding_member_number), 0) AS max_num
  FROM businesses
  WHERE is_founding_member = TRUE
    AND founding_member_number IS NOT NULL
)
UPDATE businesses b
SET
  is_founding_member = TRUE,
  founding_member_number = offset_base.max_num + ranked.rn,
  updated_at = NOW()
FROM ranked, offset_base
WHERE b.id = ranked.id
  AND offset_base.max_num + ranked.rn <= 100
  AND NOT EXISTS (
    SELECT 1 FROM businesses x
    WHERE x.founding_member_number = offset_base.max_num + ranked.rn
  );
