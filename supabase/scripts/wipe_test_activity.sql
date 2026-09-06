-- =============================================================================
-- ONE-OFF: wipe test activity (keep users, admins, businesses, markets)
-- Run in Supabase → SQL Editor. Review carefully before executing.
-- =============================================================================
-- KEEPS:
--   auth.users, profiles (roles/admins/membership fields)
--   businesses, categories, markets
--   business_availability / blocks (schedules)
--   subscriptions, network_applications, waitlist, feedback
--   admin_action_sessions, email_otps
--
-- CLEARS:
--   deals + favorites + redemptions + bookings
--   passport stamps/grants/credits
--   votes, ratings, view counters
--   notifications, media posts, business posts
--   referrals + ambassador reward rows (invite history — accounts stay)
--   analytics_events (if present)
-- =============================================================================

BEGIN;

-- Child activity first
DELETE FROM user_deal_favorites;
DELETE FROM redemptions;
DELETE FROM bookings;

-- Deals (deal_images is usually a column/array on deals, not a separate table)
DELETE FROM deals;

-- Passport reset
DELETE FROM passport_reward_grants;
UPDATE passport_progress
SET stamps_count = 0,
    rewards_unlocked = 0,
    last_stamp_at = NULL,
    updated_at = NOW();

UPDATE profiles
SET passport_redemption_credits = 0
WHERE passport_redemption_credits IS DISTINCT FROM 0;

-- Social / discovery noise
DELETE FROM business_votes;
DELETE FROM business_ratings;
DELETE FROM user_favorites;

UPDATE business_views SET count = 0 WHERE count IS DISTINCT FROM 0;
UPDATE businesses SET view_count = 0 WHERE view_count IS DISTINCT FROM 0;

-- Content / inbox
DELETE FROM notifications;
DELETE FROM media_posts;
DELETE FROM business_posts;

-- Invite history only (users remain)
DELETE FROM ambassador_rewards;
DELETE FROM referrals;

-- Analytics (ignore if migration 035 not applied)
DO $$
BEGIN
  IF to_regclass('public.analytics_events') IS NOT NULL THEN
    EXECUTE 'DELETE FROM analytics_events';
  END IF;
END $$;

COMMIT;

-- Sanity counts (should be 0 for wiped tables)
SELECT 'deals' AS table_name, COUNT(*)::int AS rows FROM deals
UNION ALL SELECT 'bookings', COUNT(*)::int FROM bookings
UNION ALL SELECT 'redemptions', COUNT(*)::int FROM redemptions
UNION ALL SELECT 'profiles (kept)', COUNT(*)::int FROM profiles
UNION ALL SELECT 'businesses (kept)', COUNT(*)::int FROM businesses;
