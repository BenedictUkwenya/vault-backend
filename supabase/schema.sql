-- ============================================================
-- Vault App — Supabase Schema
-- ============================================================

-- ============================================================
-- CLEANUP — safe to re-run
-- ============================================================
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS increment_redemption_count() CASCADE;
DROP FUNCTION IF EXISTS increment_business_views(UUID) CASCADE;
DROP FUNCTION IF EXISTS set_updated_at() CASCADE;
DROP TABLE IF EXISTS feedback CASCADE;
DROP TABLE IF EXISTS waitlist CASCADE;
DROP TABLE IF EXISTS business_views CASCADE;
DROP TABLE IF EXISTS business_votes CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS user_favorites CASCADE;
DROP TABLE IF EXISTS referrals CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS bookings CASCADE;
DROP TABLE IF EXISTS redemptions CASCADE;
DROP TABLE IF EXISTS deals CASCADE;
DROP TABLE IF EXISTS businesses CASCADE;
DROP TABLE IF EXISTS categories CASCADE;
DROP TABLE IF EXISTS profiles CASCADE;
DROP TYPE IF EXISTS notification_type CASCADE;
DROP TYPE IF EXISTS subscription_status CASCADE;
DROP TYPE IF EXISTS referral_status CASCADE;
DROP TYPE IF EXISTS booking_status CASCADE;
DROP TYPE IF EXISTS redemption_method CASCADE;
DROP TYPE IF EXISTS deal_type CASCADE;
DROP TYPE IF EXISTS membership_tier CASCADE;
DROP TYPE IF EXISTS user_role CASCADE;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUMS
-- ============================================================
CREATE TYPE user_role AS ENUM ('user', 'business', 'ambassador', 'admin', 'super_admin');
CREATE TYPE membership_tier AS ENUM ('free', 'paid');
CREATE TYPE deal_type AS ENUM ('general', 'food', 'retail', 'entertainment', 'wellness', 'travel', 'service');
CREATE TYPE redemption_method AS ENUM ('qr', 'code', 'show_card');
CREATE TYPE booking_status AS ENUM ('pending', 'approved', 'denied', 'cancelled', 'completed');
CREATE TYPE referral_status AS ENUM ('pending', 'completed');
CREATE TYPE subscription_status AS ENUM ('active', 'canceled', 'incomplete', 'past_due', 'trialing', 'unpaid');
CREATE TYPE notification_type AS ENUM ('deal', 'booking', 'membership', 'referral', 'system', 'payment');

-- ============================================================
-- TABLES
-- ============================================================

-- profiles (extends auth.users via trigger)
CREATE TABLE profiles (
  id             UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name      TEXT,
  avatar_url     TEXT,
  email          TEXT,
  phone          TEXT,
  city           TEXT,
  role           user_role NOT NULL DEFAULT 'user',
  membership_tier membership_tier NOT NULL DEFAULT 'free',
  membership_expires_at TIMESTAMPTZ,
  referral_code  TEXT UNIQUE,
  referral_count INT NOT NULL DEFAULT 0,
  streak_count   INT NOT NULL DEFAULT 0,
  total_savings  NUMERIC(10,2) NOT NULL DEFAULT 0,
  stripe_customer_id TEXT UNIQUE,
  is_banned      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profiles_referral_code ON profiles(referral_code);
CREATE INDEX idx_profiles_stripe_customer ON profiles(stripe_customer_id);

-- categories
CREATE TABLE categories (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  icon        TEXT NOT NULL,
  color       TEXT NOT NULL DEFAULT '#6C63FF',
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- businesses
CREATE TABLE businesses (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  category_id      UUID REFERENCES categories(id),
  name             TEXT NOT NULL,
  description      TEXT,
  address          TEXT,
  city             TEXT NOT NULL,
  state            TEXT,
  zip              TEXT,
  phone            TEXT,
  email            TEXT,
  website          TEXT,
  logo_url         TEXT,
  cover_url        TEXT,
  images           TEXT[] DEFAULT '{}',
  is_approved      BOOLEAN NOT NULL DEFAULT FALSE,
  is_verified      BOOLEAN NOT NULL DEFAULT FALSE,
  rejection_reason TEXT,
  rating_avg       NUMERIC(3,2) NOT NULL DEFAULT 0,
  view_count       INT NOT NULL DEFAULT 0,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_businesses_owner ON businesses(owner_id);
CREATE INDEX idx_businesses_category ON businesses(category_id);
CREATE INDEX idx_businesses_city ON businesses(city);
CREATE INDEX idx_businesses_approved ON businesses(is_approved);
CREATE INDEX idx_businesses_name_trgm ON businesses USING GIN (name gin_trgm_ops);

-- deals
CREATE TABLE deals (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id          UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title                TEXT NOT NULL,
  description          TEXT,
  deal_type            deal_type NOT NULL DEFAULT 'general',
  redemption_method    redemption_method NOT NULL DEFAULT 'qr',
  discount_percentage  INT NOT NULL CHECK (discount_percentage >= 25),
  original_price       NUMERIC(10,2),
  terms                TEXT,
  image_url            TEXT,
  images               TEXT[] DEFAULT '{}',
  end_date             TIMESTAMPTZ NOT NULL,
  max_redemptions      INT,
  redemption_count     INT NOT NULL DEFAULT 0,
  is_active            BOOLEAN NOT NULL DEFAULT TRUE,
  is_college_deal      BOOLEAN NOT NULL DEFAULT FALSE,
  is_deal_of_week      BOOLEAN NOT NULL DEFAULT FALSE,
  requires_paid_tier   BOOLEAN NOT NULL DEFAULT FALSE,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deals_business ON deals(business_id);
CREATE INDEX idx_deals_active ON deals(is_active, end_date);
CREATE INDEX idx_deals_college ON deals(is_college_deal);
CREATE INDEX idx_deals_dow ON deals(is_deal_of_week);

-- redemptions
CREATE TABLE redemptions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  deal_id         UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  business_id     UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  savings_amount  NUMERIC(10,2),
  redeemed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  verified_at     TIMESTAMPTZ
);

CREATE INDEX idx_redemptions_user ON redemptions(user_id);
CREATE INDEX idx_redemptions_deal ON redemptions(deal_id);
CREATE INDEX idx_redemptions_business ON redemptions(business_id);

-- bookings
CREATE TABLE bookings (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id          UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  business_id      UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  deal_id          UUID REFERENCES deals(id) ON DELETE SET NULL,
  service_requested TEXT NOT NULL,
  preferred_date   DATE NOT NULL,
  preferred_time   TEXT NOT NULL,
  notes            TEXT,
  status           booking_status NOT NULL DEFAULT 'pending',
  response_note    TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_bookings_user ON bookings(user_id);
CREATE INDEX idx_bookings_business ON bookings(business_id);
CREATE INDEX idx_bookings_status ON bookings(status);

-- subscriptions
CREATE TABLE subscriptions (
  id                       UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id                  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  stripe_subscription_id   TEXT UNIQUE NOT NULL,
  stripe_customer_id       TEXT NOT NULL,
  status                   subscription_status NOT NULL DEFAULT 'active',
  subscription_type        TEXT NOT NULL DEFAULT 'member',
  current_period_start     TIMESTAMPTZ,
  current_period_end       TIMESTAMPTZ,
  cancel_at_period_end     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(status);

-- referrals
CREATE TABLE referrals (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  referrer_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referred_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  referral_code  TEXT NOT NULL,
  status         referral_status NOT NULL DEFAULT 'pending',
  completed_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(referred_id)
);

CREATE INDEX idx_referrals_referrer ON referrals(referrer_id);

-- user_favorites
CREATE TABLE user_favorites (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, business_id)
);

CREATE INDEX idx_favorites_user ON user_favorites(user_id);

-- notifications
CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  type        notification_type NOT NULL DEFAULT 'system',
  data        JSONB,
  is_read     BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id, is_read);

-- business_votes
CREATE TABLE business_votes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id  UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_votes_business ON business_votes(business_id);

-- business_views (aggregated)
CREATE TABLE business_views (
  business_id  UUID PRIMARY KEY REFERENCES businesses(id) ON DELETE CASCADE,
  count        BIGINT NOT NULL DEFAULT 0,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- waitlist
CREATE TABLE waitlist (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email      TEXT NOT NULL UNIQUE,
  city       TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- feedback
CREATE TABLE feedback (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     UUID REFERENCES profiles(id) ON DELETE SET NULL,
  rating      INT CHECK (rating BETWEEN 1 AND 5),
  category    TEXT,
  message     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- VIEWS
-- ============================================================

CREATE OR REPLACE VIEW deals_with_business AS
SELECT
  d.*,
  b.name            AS business_name,
  b.logo_url        AS business_logo_url,
  b.city            AS business_city,
  b.state           AS business_state,
  b.is_approved     AS business_is_approved,
  c.name            AS category_name,
  c.id              AS category_id
FROM deals d
JOIN businesses b ON d.business_id = b.id
LEFT JOIN categories c ON b.category_id = c.id;

CREATE OR REPLACE VIEW businesses_with_stats AS
SELECT
  b.*,
  c.name  AS category_name,
  c.icon  AS category_icon,
  c.color AS category_color,
  COALESCE(d.active_deals_count, 0)   AS active_deals_count,
  COALESCE(bv.count, b.view_count, 0) AS total_views
FROM businesses b
LEFT JOIN categories c ON b.category_id = c.id
LEFT JOIN (
  SELECT business_id, COUNT(*) AS active_deals_count
  FROM deals
  WHERE is_active = TRUE AND end_date > NOW()
  GROUP BY business_id
) d ON b.id = d.business_id
LEFT JOIN business_views bv ON b.id = bv.business_id;

CREATE OR REPLACE VIEW bookings_with_details AS
SELECT
  bk.*,
  p.full_name   AS user_full_name,
  p.avatar_url  AS user_avatar_url,
  b.name        AS business_name,
  b.logo_url    AS business_logo_url,
  d.title       AS deal_title
FROM bookings bk
JOIN profiles p ON bk.user_id = p.id
JOIN businesses b ON bk.business_id = b.id
LEFT JOIN deals d ON bk.deal_id = d.id;

-- ============================================================
-- FUNCTIONS & TRIGGERS
-- ============================================================

-- Auto-create profile on auth.users insert
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public AS $$
DECLARE
  code TEXT;
BEGIN
  -- Generate unique referral code using only built-in functions
  LOOP
    code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 8));
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE referral_code = code);
  END LOOP;

  INSERT INTO public.profiles (id, email, full_name, referral_code)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    code
  );

  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Increment deal redemption count
CREATE OR REPLACE FUNCTION increment_redemption_count()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  UPDATE deals SET redemption_count = redemption_count + 1 WHERE id = NEW.deal_id;
  UPDATE profiles SET total_savings = total_savings + COALESCE(NEW.savings_amount, 0) WHERE id = NEW.user_id;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER on_redemption_created
  AFTER INSERT ON redemptions
  FOR EACH ROW EXECUTE FUNCTION increment_redemption_count();

-- Increment business view count (called via RPC)
CREATE OR REPLACE FUNCTION increment_business_views(business_id UUID)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO business_views (business_id, count)
  VALUES (business_id, 1)
  ON CONFLICT (business_id) DO UPDATE
  SET count = business_views.count + 1, updated_at = NOW();
END;
$$;

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER set_profiles_updated_at
  BEFORE UPDATE ON profiles FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER set_businesses_updated_at
  BEFORE UPDATE ON businesses FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER set_deals_updated_at
  BEFORE UPDATE ON deals FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER set_bookings_updated_at
  BEFORE UPDATE ON bookings FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE OR REPLACE TRIGGER set_subscriptions_updated_at
  BEFORE UPDATE ON subscriptions FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE business_votes ENABLE ROW LEVEL SECURITY;

-- profiles
CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Service role has full access to profiles" ON profiles USING (auth.role() = 'service_role');

-- businesses (public read for approved businesses)
CREATE POLICY "Anyone can view approved businesses" ON businesses FOR SELECT USING (is_approved = TRUE);
CREATE POLICY "Owners can manage own business" ON businesses FOR ALL USING (auth.uid() = owner_id);
CREATE POLICY "Service role full access to businesses" ON businesses USING (auth.role() = 'service_role');

-- deals (public read for active deals of approved businesses)
CREATE POLICY "Anyone can view active deals" ON deals FOR SELECT
  USING (is_active = TRUE AND end_date > NOW());
CREATE POLICY "Business owners can manage own deals" ON deals FOR ALL
  USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY "Service role full access to deals" ON deals USING (auth.role() = 'service_role');

-- redemptions
CREATE POLICY "Users can view own redemptions" ON redemptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access to redemptions" ON redemptions USING (auth.role() = 'service_role');

-- bookings
CREATE POLICY "Users can view own bookings" ON bookings FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Business owners can view their bookings" ON bookings FOR SELECT
  USING (business_id IN (SELECT id FROM businesses WHERE owner_id = auth.uid()));
CREATE POLICY "Service role full access to bookings" ON bookings USING (auth.role() = 'service_role');

-- subscriptions
CREATE POLICY "Users can view own subscriptions" ON subscriptions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Service role full access to subscriptions" ON subscriptions USING (auth.role() = 'service_role');

-- referrals
CREATE POLICY "Users can view own referrals" ON referrals FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referred_id);
CREATE POLICY "Service role full access to referrals" ON referrals USING (auth.role() = 'service_role');

-- user_favorites
CREATE POLICY "Users manage own favorites" ON user_favorites FOR ALL USING (auth.uid() = user_id);

-- notifications
CREATE POLICY "Users can view own notifications" ON notifications FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can update own notifications" ON notifications FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Service role full access to notifications" ON notifications USING (auth.role() = 'service_role');

-- business_votes
CREATE POLICY "Anyone can view votes" ON business_votes FOR SELECT USING (TRUE);
CREATE POLICY "Users can insert own votes" ON business_votes FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Service role full access to votes" ON business_votes USING (auth.role() = 'service_role');

-- ============================================================
-- SEED DATA — Categories
-- ============================================================
INSERT INTO categories (name, icon, color, sort_order) VALUES
  ('Food & Drink',      '🍔', '#FF6B6B', 1),
  ('Shopping',          '🛍️', '#4ECDC4', 2),
  ('Beauty & Wellness', '💅', '#FFB800', 3),
  ('Entertainment',     '🎬', '#6C63FF', 4),
  ('Fitness',           '💪', '#10B981', 5),
  ('Travel',            '✈️', '#3B82F6', 6),
  ('Services',          '🔧', '#9B59B6', 7),
  ('Health',            '🏥', '#E74C3C', 8),
  ('Education',         '📚', '#F39C12', 9),
  ('Tech',              '💻', '#1ABC9C', 10)
ON CONFLICT (name) DO NOTHING;
