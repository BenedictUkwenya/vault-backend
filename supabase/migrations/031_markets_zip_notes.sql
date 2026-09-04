-- Optional zip / region notes on city markets
ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS zip TEXT;

ALTER TABLE markets
  ADD COLUMN IF NOT EXISTS notes TEXT;
