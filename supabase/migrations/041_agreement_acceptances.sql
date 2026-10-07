-- 041: Evidence for Member Terms, Provider Agreement, BL Pro Addendum,
-- subscription authorization and offer confirmation. Version 0.2.

CREATE TABLE IF NOT EXISTS agreement_acceptances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  agreement_id TEXT NOT NULL,
  version TEXT NOT NULL,
  checkbox_text TEXT NOT NULL,
  signer_name TEXT,
  provider_legal_name TEXT,
  entity_type TEXT,
  signer_title TEXT,
  accepted_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS agreement_acceptances_user_idx
  ON agreement_acceptances (user_id, agreement_id, accepted_at DESC);

ALTER TABLE businesses ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS signer_name TEXT;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS signer_title TEXT;

ALTER TABLE bl_pros ADD COLUMN IF NOT EXISTS legal_name TEXT;
ALTER TABLE bl_pros ADD COLUMN IF NOT EXISTS entity_type TEXT;
ALTER TABLE bl_pros ADD COLUMN IF NOT EXISTS signer_name TEXT;
ALTER TABLE bl_pros ADD COLUMN IF NOT EXISTS signer_title TEXT;
ALTER TABLE bl_pros ADD COLUMN IF NOT EXISTS terms_version TEXT;
