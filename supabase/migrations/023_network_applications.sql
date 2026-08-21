-- Network website membership / partner applications (Black Limitless Network marketing site)

CREATE TABLE IF NOT EXISTS network_applications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  location TEXT NOT NULL,
  business_description TEXT,
  is_student BOOLEAN NOT NULL DEFAULT FALSE,
  membership_interest TEXT NOT NULL,
  hear_about TEXT NOT NULL,
  applicant_type TEXT NOT NULL DEFAULT 'member'
    CHECK (applicant_type IN ('member', 'partner')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'reviewing', 'approved', 'rejected', 'contacted')),
  notes TEXT,
  source_page TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_network_applications_email
  ON network_applications (LOWER(email));

CREATE INDEX IF NOT EXISTS idx_network_applications_status
  ON network_applications (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_network_applications_created
  ON network_applications (created_at DESC);
