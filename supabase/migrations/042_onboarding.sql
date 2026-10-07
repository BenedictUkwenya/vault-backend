-- 042: Short basic onboarding, needs-information status, optional verification checks,
-- and admin-configured category credential rules.

ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_review_status_check;
ALTER TABLE businesses ADD CONSTRAINT businesses_review_status_check
  CHECK (review_status IN ('draft', 'pending', 'needs_information', 'approved', 'rejected', 'suspended'));

ALTER TABLE bl_pros DROP CONSTRAINT IF EXISTS bl_pros_status_check;
ALTER TABLE bl_pros ADD CONSTRAINT bl_pros_status_check
  CHECK (status IN ('draft', 'pending', 'needs_information', 'approved', 'rejected', 'suspended'));

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS service_mode TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS service_area TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS evidence_note TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS info_request TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS credential_expires_at TIMESTAMPTZ;

ALTER TABLE bl_pros ADD COLUMN IF NOT EXISTS service_mode TEXT;
ALTER TABLE bl_pros ADD COLUMN IF NOT EXISTS service_area TEXT;
ALTER TABLE bl_pros ADD COLUMN IF NOT EXISTS payment_method TEXT;
ALTER TABLE bl_pros ADD COLUMN IF NOT EXISTS reference_contact TEXT;
ALTER TABLE bl_pros ADD COLUMN IF NOT EXISTS info_request TEXT;
ALTER TABLE bl_pros ADD COLUMN IF NOT EXISTS credential_expires_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS verification_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('business', 'pro')),
  entity_id UUID NOT NULL,
  check_type TEXT NOT NULL CHECK (check_type IN ('identity', 'ownership', 'credential', 'portfolio')),
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('not_requested', 'pending', 'needs_information', 'completed', 'unsuccessful', 'expired')),
  reviewer_id UUID,
  reviewed_at TIMESTAMPTZ,
  source TEXT,
  evidence_note TEXT,
  result_note TEXT,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (entity_type, entity_id, check_type)
);

CREATE INDEX IF NOT EXISTS verification_checks_entity_idx
  ON verification_checks (entity_type, entity_id, status);

-- Empty until Black Limitless adds a row. Developers do not decide which services need a license.
CREATE TABLE IF NOT EXISTS service_category_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_name TEXT NOT NULL,
  applies_to TEXT NOT NULL CHECK (applies_to IN ('business', 'pro', 'both')),
  requires_credential BOOLEAN NOT NULL DEFAULT TRUE,
  credential_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (category_name, applies_to)
);
