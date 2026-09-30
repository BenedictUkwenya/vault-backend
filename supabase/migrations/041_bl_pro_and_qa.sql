-- 041: BL Pro professionals directory + quality-assurance review log.

CREATE TABLE IF NOT EXISTS bl_pros (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id           UUID NOT NULL UNIQUE REFERENCES profiles(id) ON DELETE CASCADE,
  display_name      TEXT NOT NULL,
  profession        TEXT NOT NULL,
  bio               TEXT,
  city              TEXT,
  state             TEXT,
  country           TEXT DEFAULT 'United States',
  phone             TEXT,
  email             TEXT,
  website           TEXT,
  instagram_handle  TEXT,
  years_experience  INT,
  services          TEXT[] NOT NULL DEFAULT '{}',
  avatar_url        TEXT,
  portfolio_urls    TEXT[] NOT NULL DEFAULT '{}',
  proof_urls        TEXT[] NOT NULL DEFAULT '{}',
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'approved', 'rejected', 'suspended')),
  rejection_reason  TEXT,
  is_founding       BOOLEAN NOT NULL DEFAULT FALSE,
  founding_number   INT UNIQUE,
  terms_accepted_at TIMESTAMPTZ,
  approved_at       TIMESTAMPTZ,
  reviewed_at       TIMESTAMPTZ,
  reviewed_by       UUID REFERENCES profiles(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bl_pros_status ON bl_pros (status, approved_at DESC);
CREATE INDEX IF NOT EXISTS idx_bl_pros_profession ON bl_pros (lower(profession));

-- Writes go through the backend service role; proof_urls stay private because the
-- API never selects them for public routes.
ALTER TABLE bl_pros ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Approved BL Pros are public" ON bl_pros;
CREATE POLICY "Approved BL Pros are public" ON bl_pros FOR SELECT USING (status = 'approved');
DROP POLICY IF EXISTS "Owners read own BL Pro profile" ON bl_pros;
CREATE POLICY "Owners read own BL Pro profile" ON bl_pros FOR SELECT TO authenticated USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS qa_reviews (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  entity_type  TEXT NOT NULL CHECK (entity_type IN ('business', 'pro')),
  entity_id    UUID NOT NULL,
  reviewer_id  UUID REFERENCES profiles(id) ON DELETE SET NULL,
  checklist    JSONB NOT NULL DEFAULT '{}',
  outcome      TEXT NOT NULL CHECK (outcome IN ('approved', 'rejected', 'note')),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_qa_reviews_entity ON qa_reviews (entity_type, entity_id, created_at DESC);
ALTER TABLE qa_reviews ENABLE ROW LEVEL SECURITY;

-- Allow BL Pro portfolio/proof photos in the shared upload bucket.
DROP POLICY IF EXISTS "Authenticated users upload own deal images" ON storage.objects;
CREATE POLICY "Authenticated users upload own deal images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'deal-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    (
      (storage.foldername(name))[2] IN ('deals', 'avatar', 'logo', 'cover', 'media-thumbs', 'pros')
      AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp')
    )
    OR (
      (storage.foldername(name))[2] = 'media-videos'
      AND lower(storage.extension(name)) IN ('mp4', 'mov', 'webm')
    )
  )
);
