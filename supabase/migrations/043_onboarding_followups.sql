-- 043: Evidence photos for business applications and richer member offers.
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS evidence_urls TEXT[] DEFAULT '{}';
ALTER TABLE deals ADD COLUMN IF NOT EXISTS exclusions TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS availability_note TEXT;
