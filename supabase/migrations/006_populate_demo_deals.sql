-- ============================================================
-- 006 — Populate demo deals & polish businesses for a lively feed
-- Run in Supabase SQL Editor (safe to re-run; skips duplicate titles)
-- ============================================================

-- 1. Avatar placeholders for businesses without logos
UPDATE businesses
SET logo_url = 'https://ui-avatars.com/api/?name=' || replace(name, ' ', '+') || '&background=6C5CE7&color=fff&size=128&bold=true'
WHERE (logo_url IS NULL OR logo_url = '') AND is_approved = TRUE;

-- 2. Boost views & feature flags so trending looks alive
UPDATE businesses
SET
  view_count = GREATEST(view_count, (50 + (random() * 250))::int),
  is_featured = CASE WHEN random() > 0.45 THEN TRUE ELSE is_featured END
WHERE is_approved = TRUE;

-- 3. Clear old deal-of-week flags (re-assign below)
UPDATE deals SET is_deal_of_week = FALSE WHERE is_deal_of_week = TRUE;

-- 4. Insert 25+ deals across all approved businesses
DO $$
DECLARE
  biz RECORD;
  deal_titles TEXT[] := ARRAY[
    'Member Night Special', 'Happy Hour Exclusive', 'Weekend Brunch Deal', 'Lunch Rush Savings',
    'Date Night Package', 'Family Feast Offer', 'Student Flash Sale', 'Early Bird Discount',
    'Late Night Bites', 'Seasonal Menu Deal', 'First Visit Bonus', 'Loyalty Member Perk',
    'Flash Friday Sale', 'Sunday Funday Deal', 'Midweek Madness', 'VIP Table Offer',
    'Cocktail Hour Special', 'Buy One Get One', 'Free Appetizer Deal', 'Dessert on Us',
    'Live Music Night', 'Game Day Special', 'Wellness Wednesday', 'Retail Therapy Deal',
    'Grand Opening Promo', 'Anniversary Celebration', 'Local Love Discount', 'City Explorer Pass'
  ];
  deal_types deal_type[] := ARRAY[
    'food', 'food', 'entertainment', 'retail', 'wellness', 'service', 'general', 'food',
    'entertainment', 'retail', 'food', 'travel', 'general', 'food', 'entertainment',
    'retail', 'food', 'wellness', 'service', 'entertainment'
  ];
  idx INT := 0;
  t TEXT;
  pct INT;
  d_type deal_type;
  is_week BOOLEAN;
  is_college BOOLEAN;
  redemptions INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM businesses WHERE is_approved = TRUE) THEN
    RAISE NOTICE 'No approved businesses — approve businesses first, then re-run.';
    RETURN;
  END IF;

  FOR biz IN
    SELECT b.id, b.name, row_number() OVER (ORDER BY b.created_at) AS rn
    FROM businesses b
    WHERE b.is_approved = TRUE
  LOOP
    FOR j IN 1..9 LOOP
      idx := idx + 1;
      t := deal_titles[1 + ((idx - 1) % array_length(deal_titles, 1))];
      d_type := deal_types[1 + ((idx - 1) % array_length(deal_types, 1))];
      pct := 25 + ((idx * 7) % 45);
      is_week := idx <= 8;
      is_college := idx IN (3, 7, 11, 15, 19);
      redemptions := (random() * 40)::int;

      IF EXISTS (
        SELECT 1 FROM deals d
        WHERE d.business_id = biz.id AND d.title = t || ' — ' || biz.name
      ) THEN
        CONTINUE;
      END IF;

      INSERT INTO deals (
        business_id, title, description, deal_type,
        discount_percentage, end_date, is_active,
        is_deal_of_week, is_college_deal, redemption_count,
        image_url
      ) VALUES (
        biz.id,
        t || ' — ' || biz.name,
        'Vault members save ' || pct || '% at ' || biz.name || '. Show your QR at checkout.',
        d_type,
        pct,
        NOW() + ((30 + (idx % 60)) || ' days')::interval,
        TRUE,
        is_week,
        is_college,
        redemptions,
        'https://picsum.photos/seed/' || replace(biz.id::text, '-', '') || idx || '/400/300'
      );
    END LOOP;
  END LOOP;

  RAISE NOTICE 'Demo deals seeded. Total active deals: %',
    (SELECT COUNT(*) FROM deals WHERE is_active AND end_date > NOW());
END $$;

-- 5. Ensure at least some entertainment “events” exist
UPDATE deals
SET deal_type = 'entertainment'
WHERE id IN (
  SELECT id FROM deals
  WHERE is_active AND end_date > NOW()
  ORDER BY random()
  LIMIT 8
);

-- 6. Summary
SELECT
  (SELECT COUNT(*) FROM deals WHERE is_active AND end_date > NOW()) AS active_deals,
  (SELECT COUNT(*) FROM deals WHERE is_deal_of_week AND is_active AND end_date > NOW()) AS deals_of_week,
  (SELECT COUNT(*) FROM businesses WHERE is_approved) AS approved_businesses;
