-- 037: Security hardening + data integrity.
--
-- The mobile app ships the Supabase anon key and reads a few tables directly.
-- All writes go through the Express API (service role), so clients get SELECT
-- only, and privileged columns are additionally guarded by triggers.
--
-- Safe to re-run.

-- ============================================================
-- 1. Remove client write paths on profiles / businesses / deals / votes
-- ============================================================

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
DROP POLICY IF EXISTS "Owners can manage own business" ON businesses;
DROP POLICY IF EXISTS "Business owners can manage own deals" ON deals;
DROP POLICY IF EXISTS "Users can insert own votes" ON business_votes;

-- Owners still need to read their own (possibly unapproved / inactive) rows.
DROP POLICY IF EXISTS "Owners can view own business" ON businesses;
CREATE POLICY "Owners can view own business" ON businesses
  FOR SELECT USING (auth.uid() = owner_id);

DROP POLICY IF EXISTS "Owners can view own deals" ON deals;
CREATE POLICY "Owners can view own deals" ON deals
  FOR SELECT USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));

-- Complimentary plan grants (admin grants, referral free months), kept separate
-- from Stripe so renewal webhooks don't overwrite them.
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS comp_tier membership_tier,
  ADD COLUMN IF NOT EXISTS comp_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS comp_granted_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS comp_reason TEXT;

-- Existing paid tiers without a live Stripe subscription were granted manually.
UPDATE profiles p
SET comp_tier = p.membership_tier,
    comp_expires_at = p.membership_expires_at,
    comp_reason = 'backfill_manual_grant'
WHERE p.membership_tier <> 'free'
  AND p.comp_tier IS NULL
  AND (p.membership_expires_at IS NULL OR p.membership_expires_at > NOW())
  AND NOT EXISTS (
    SELECT 1 FROM subscriptions s
    WHERE s.user_id = p.id
      AND s.status IN ('active', 'trialing', 'past_due')
      AND COALESCE(s.subscription_type, '') <> 'business'
  );

-- ============================================================
-- 2. Column guards (defence in depth if a write policy is ever re-added)
-- ============================================================

CREATE OR REPLACE FUNCTION is_client_role()
RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
  SELECT COALESCE(auth.role(), '') IN ('authenticated', 'anon');
$$;

CREATE OR REPLACE FUNCTION guard_profile_privileged_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF is_client_role() AND (
    NEW.role IS DISTINCT FROM OLD.role OR
    NEW.membership_tier IS DISTINCT FROM OLD.membership_tier OR
    NEW.membership_expires_at IS DISTINCT FROM OLD.membership_expires_at OR
    NEW.is_banned IS DISTINCT FROM OLD.is_banned OR
    NEW.referral_code IS DISTINCT FROM OLD.referral_code OR
    NEW.referral_count IS DISTINCT FROM OLD.referral_count OR
    NEW.total_savings IS DISTINCT FROM OLD.total_savings OR
    NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id OR
    NEW.student_verified_at IS DISTINCT FROM OLD.student_verified_at OR
    NEW.ambassador_unlocked_at IS DISTINCT FROM OLD.ambassador_unlocked_at OR
    NEW.passport_redemption_credits IS DISTINCT FROM OLD.passport_redemption_credits OR
    NEW.streak_count IS DISTINCT FROM OLD.streak_count OR
    NEW.comp_tier IS DISTINCT FROM OLD.comp_tier OR
    NEW.comp_expires_at IS DISTINCT FROM OLD.comp_expires_at
  ) THEN
    RAISE EXCEPTION 'Not allowed to change privileged profile fields' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_profile_privileged_columns ON profiles;
CREATE TRIGGER guard_profile_privileged_columns
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION guard_profile_privileged_columns();

CREATE OR REPLACE FUNCTION guard_business_moderation_columns()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF is_client_role() THEN
    IF TG_OP = 'INSERT' THEN
      RAISE EXCEPTION 'Register businesses through the API' USING ERRCODE = '42501';
    END IF;
    IF NEW.is_approved IS DISTINCT FROM OLD.is_approved OR
       NEW.is_featured IS DISTINCT FROM OLD.is_featured OR
       NEW.is_verified IS DISTINCT FROM OLD.is_verified OR
       NEW.is_founding_member IS DISTINCT FROM OLD.is_founding_member OR
       NEW.founding_member_number IS DISTINCT FROM OLD.founding_member_number OR
       NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason OR
       NEW.owner_id IS DISTINCT FROM OLD.owner_id OR
       NEW.subscription_status IS DISTINCT FROM OLD.subscription_status OR
       NEW.subscription_expires_at IS DISTINCT FROM OLD.subscription_expires_at THEN
      RAISE EXCEPTION 'Not allowed to change moderation fields' USING ERRCODE = '42501';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS guard_business_moderation_columns ON businesses;
CREATE TRIGGER guard_business_moderation_columns
  BEFORE INSERT OR UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION guard_business_moderation_columns();

CREATE OR REPLACE FUNCTION guard_deal_client_writes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF is_client_role() THEN
    RAISE EXCEPTION 'Manage deals through the API' USING ERRCODE = '42501';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS guard_deal_client_writes ON deals;
CREATE TRIGGER guard_deal_client_writes
  BEFORE INSERT OR UPDATE OR DELETE ON deals FOR EACH ROW EXECUTE FUNCTION guard_deal_client_writes();

-- ============================================================
-- 3. RLS on every table (service role bypasses RLS)
-- ============================================================

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'categories', 'passport_progress', 'business_availability', 'business_availability_blocks',
    'business_views', 'waitlist', 'feedback', 'media_posts', 'markets', 'ambassador_rewards',
    'business_ratings', 'network_applications', 'email_otps', 'business_posts',
    'admin_action_sessions'
  ] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;

-- Public read where the anon app reads directly (explore/business views join these).
DROP POLICY IF EXISTS "Anyone can view categories" ON categories;
CREATE POLICY "Anyone can view categories" ON categories FOR SELECT USING (TRUE);

DROP POLICY IF EXISTS "Anyone can view business view counts" ON business_views;
CREATE POLICY "Anyone can view business view counts" ON business_views FOR SELECT USING (TRUE);

DO $$
BEGIN
  IF to_regclass('public.markets') IS NOT NULL THEN
    DROP POLICY IF EXISTS "Anyone can view markets" ON markets;
    CREATE POLICY "Anyone can view markets" ON markets FOR SELECT USING (TRUE);
  END IF;
END $$;

-- ============================================================
-- 5. Redemptions count only once staff verify them
-- ============================================================

DROP TRIGGER IF EXISTS on_redemption_created ON redemptions;

CREATE OR REPLACE FUNCTION count_verified_redemption()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.verified_at IS NULL AND NEW.verified_at IS NOT NULL THEN
    UPDATE deals SET redemption_count = redemption_count + 1 WHERE id = NEW.deal_id;
    UPDATE profiles SET total_savings = total_savings + COALESCE(NEW.savings_amount, 0) WHERE id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_redemption_verified ON redemptions;
CREATE TRIGGER on_redemption_verified
  AFTER UPDATE OF verified_at ON redemptions
  FOR EACH ROW EXECUTE FUNCTION count_verified_redemption();

-- Recompute derived counters from verified rows only.
UPDATE deals d SET redemption_count = COALESCE(r.cnt, 0)
FROM (SELECT deal_id, COUNT(*) AS cnt FROM redemptions WHERE verified_at IS NOT NULL GROUP BY deal_id) r
WHERE r.deal_id = d.id AND d.redemption_count IS DISTINCT FROM COALESCE(r.cnt, 0);
UPDATE deals d SET redemption_count = 0
WHERE redemption_count <> 0
  AND NOT EXISTS (SELECT 1 FROM redemptions r WHERE r.deal_id = d.id AND r.verified_at IS NOT NULL);

ALTER TABLE profiles DISABLE TRIGGER guard_profile_privileged_columns;
UPDATE profiles p SET total_savings = COALESCE(s.total, 0)
FROM (
  SELECT user_id, SUM(COALESCE(savings_amount, 0)) AS total
  FROM redemptions WHERE verified_at IS NOT NULL GROUP BY user_id
) s
WHERE s.user_id = p.id AND p.total_savings IS DISTINCT FROM COALESCE(s.total, 0);
UPDATE profiles p SET total_savings = 0
WHERE total_savings <> 0
  AND NOT EXISTS (SELECT 1 FROM redemptions r WHERE r.user_id = p.id AND r.verified_at IS NOT NULL);
ALTER TABLE profiles ENABLE TRIGGER guard_profile_privileged_columns;

-- ============================================================
-- 6. Uniqueness (only created when existing data is already clean)
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM redemptions GROUP BY user_id, deal_id HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_redemptions_user_deal ON redemptions(user_id, deal_id);
  ELSE
    RAISE NOTICE 'Skipped uq_redemptions_user_deal: duplicate (user_id, deal_id) rows exist';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM businesses GROUP BY owner_id HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_businesses_owner ON businesses(owner_id);
  ELSE
    RAISE NOTICE 'Skipped uq_businesses_owner: some owners have several businesses';
  END IF;
END $$;

ALTER TABLE business_votes
  ADD COLUMN IF NOT EXISTS vote_month DATE
  GENERATED ALWAYS AS ((date_trunc('month', created_at AT TIME ZONE 'UTC'))::date) STORED;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM business_votes GROUP BY user_id, vote_month HAVING COUNT(*) > 1
  ) THEN
    CREATE UNIQUE INDEX IF NOT EXISTS uq_business_votes_user_month ON business_votes(user_id, vote_month);
  ELSE
    RAISE NOTICE 'Skipped uq_business_votes_user_month: duplicate monthly votes exist';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_redemptions_user_verified ON redemptions(user_id, verified_at);
CREATE INDEX IF NOT EXISTS idx_notifications_user_created ON notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_profiles_email_lower ON profiles(lower(email));

-- ============================================================
-- 7. Business review status, admin deal suspension, business timezone
-- ============================================================

ALTER TABLE businesses
  ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS timezone TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_review_status_check'
  ) THEN
    ALTER TABLE businesses ADD CONSTRAINT businesses_review_status_check
      CHECK (review_status IN ('pending', 'approved', 'rejected', 'suspended'));
  END IF;
END $$;

ALTER TABLE businesses DISABLE TRIGGER guard_business_moderation_columns;
UPDATE businesses SET review_status = 'approved' WHERE is_approved AND review_status <> 'approved';
UPDATE businesses SET review_status = 'rejected'
  WHERE NOT is_approved AND rejection_reason IS NOT NULL AND review_status = 'pending';
UPDATE businesses SET timezone = CASE
    WHEN lower(COALESCE(country, '')) IN ('nigeria', 'ng') THEN 'Africa/Lagos'
    WHEN lower(COALESCE(country, '')) IN ('united kingdom', 'uk', 'gb') THEN 'Europe/London'
    ELSE 'America/New_York'
  END
  WHERE timezone IS NULL;
ALTER TABLE businesses ENABLE TRIGGER guard_business_moderation_columns;

CREATE INDEX IF NOT EXISTS idx_businesses_review_status ON businesses(review_status);

ALTER TABLE deals
  ADD COLUMN IF NOT EXISTS admin_suspended_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS admin_suspended_reason TEXT;

-- Deal discount ceiling (floor of 25 already exists).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'deals_discount_max_check')
     AND NOT EXISTS (SELECT 1 FROM deals WHERE discount_percentage > 100) THEN
    ALTER TABLE deals ADD CONSTRAINT deals_discount_max_check CHECK (discount_percentage <= 100);
  END IF;
END $$;

-- ============================================================
-- 8. Admin audit log (service role only)
-- ============================================================

CREATE TABLE IF NOT EXISTS admin_audit_log (
  id          BIGSERIAL PRIMARY KEY,
  admin_id    UUID REFERENCES profiles(id) ON DELETE SET NULL,
  action      TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id   TEXT,
  before      JSONB,
  after       JSONB,
  ip          TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_admin_audit_target ON admin_audit_log(target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_admin_audit_admin ON admin_audit_log(admin_id, created_at DESC);
ALTER TABLE admin_audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 9. Views: recreate to pick up new columns, and run with the caller's
--    rights so RLS applies (Postgres 15+).
-- ============================================================

DROP VIEW IF EXISTS deals_with_business;
CREATE VIEW deals_with_business WITH (security_invoker = true) AS
SELECT
  d.*,
  b.name                   AS business_name,
  b.logo_url               AS business_logo_url,
  b.city                   AS business_city,
  b.state                  AS business_state,
  b.country                AS business_country,
  b.timezone               AS business_timezone,
  b.owner_id               AS business_owner_id,
  b.is_approved            AS business_is_approved,
  b.is_founding_member     AS business_is_founding_member,
  b.founding_member_number AS business_founding_member_number,
  c.name                   AS category_name,
  c.id                     AS category_id
FROM deals d
JOIN businesses b ON d.business_id = b.id
LEFT JOIN categories c ON b.category_id = c.id;

DROP VIEW IF EXISTS businesses_with_stats;
CREATE VIEW businesses_with_stats WITH (security_invoker = true) AS
SELECT
  b.*,
  c.name  AS category_name,
  c.icon  AS category_icon,
  c.color AS category_color,
  COALESCE(d.active_deals_count, 0) AS active_deals_count,
  COALESCE(bv.count, 0) AS total_views
FROM businesses b
LEFT JOIN categories c ON b.category_id = c.id
LEFT JOIN (
  SELECT business_id, COUNT(*) AS active_deals_count
  FROM deals
  WHERE is_active = TRUE AND end_date > NOW()
  GROUP BY business_id
) d ON b.id = d.business_id
LEFT JOIN business_views bv ON b.id = bv.business_id;

ALTER VIEW IF EXISTS bookings_with_details SET (security_invoker = true);
REVOKE ALL ON bookings_with_details FROM anon;

GRANT SELECT ON deals_with_business TO anon, authenticated;
GRANT SELECT ON businesses_with_stats TO anon, authenticated;

-- Market launch notifications were failing on the enum.
ALTER TYPE notification_type ADD VALUE IF NOT EXISTS 'market_launch';
