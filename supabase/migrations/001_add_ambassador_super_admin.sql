-- Run this on an EXISTING Supabase database (no full schema reset required).
-- Safe to run multiple times — skips values that already exist.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'ambassador'
  ) THEN
    ALTER TYPE user_role ADD VALUE 'ambassador';
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum e
    JOIN pg_type t ON e.enumtypid = t.oid
    WHERE t.typname = 'user_role' AND e.enumlabel = 'super_admin'
  ) THEN
    ALTER TYPE user_role ADD VALUE 'super_admin';
  END IF;
END $$;

-- Promote your account to super_admin (replace email):
-- UPDATE profiles SET role = 'super_admin' WHERE email = 'you@example.com';
