-- Allow blocking a specific time on a date, not only the whole day.

ALTER TABLE business_availability_blocks
  ADD COLUMN IF NOT EXISTS blocked_time TEXT
  CHECK (blocked_time IS NULL OR blocked_time ~ '^\d{2}:\d{2}$');

ALTER TABLE business_availability_blocks
  DROP CONSTRAINT IF EXISTS business_availability_blocks_business_id_blocked_date_key;

CREATE UNIQUE INDEX IF NOT EXISTS business_availability_blocks_unique_slot
  ON business_availability_blocks (business_id, blocked_date, (COALESCE(blocked_time, '')));
