-- Product analytics: session-aware events + aggregation for the admin dashboard.
-- Safe to run whether or not 035_analytics_events.sql has been applied.

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES profiles(id) ON DELETE SET NULL,
  event TEXT NOT NULL,
  props JSONB NOT NULL DEFAULT '{}'::jsonb,
  platform TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS session_id TEXT;
ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS app_version TEXT;

CREATE INDEX IF NOT EXISTS idx_analytics_events_created
  ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_event_created
  ON analytics_events(event, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_user_created
  ON analytics_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_events_session
  ON analytics_events(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_item
  ON analytics_events((props->>'item_type'), (props->>'item_id'))
  WHERE event IN ('impression', 'item_click');

ALTER TABLE analytics_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'analytics_events'
      AND policyname = 'Service role full access analytics_events'
  ) THEN
    CREATE POLICY "Service role full access analytics_events"
      ON analytics_events
      USING (auth.role() = 'service_role');
  END IF;
END $$;

-- Returns every aggregate the admin Analytics page needs for [p_from, p_to).
CREATE OR REPLACE FUNCTION admin_analytics_overview(p_from TIMESTAMPTZ, p_to TIMESTAMPTZ)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_kpis JSONB;
  v_daily JSONB;
  v_surfaces JSONB;
  v_top_deals JSONB;
  v_top_businesses JSONB;
  v_top_screens JSONB;
  v_top_searches JSONB;
  v_platforms JSONB;
BEGIN
  CREATE TEMP TABLE IF NOT EXISTS _ev ON COMMIT DROP AS
    SELECT * FROM analytics_events WHERE false;
  TRUNCATE _ev;
  INSERT INTO _ev
    SELECT * FROM analytics_events
    WHERE created_at >= p_from AND created_at < p_to;

  WITH sessions AS (
    SELECT session_id,
           EXTRACT(EPOCH FROM (MAX(created_at) - MIN(created_at))) AS secs
    FROM _ev
    WHERE session_id IS NOT NULL
    GROUP BY session_id
  )
  SELECT jsonb_build_object(
    'active_users', (SELECT COUNT(DISTINCT user_id) FROM _ev WHERE user_id IS NOT NULL),
    'dau', (SELECT COUNT(DISTINCT user_id) FROM analytics_events
            WHERE user_id IS NOT NULL AND created_at >= p_to - INTERVAL '1 day' AND created_at < p_to),
    'wau', (SELECT COUNT(DISTINCT user_id) FROM analytics_events
            WHERE user_id IS NOT NULL AND created_at >= p_to - INTERVAL '7 days' AND created_at < p_to),
    'mau', (SELECT COUNT(DISTINCT user_id) FROM analytics_events
            WHERE user_id IS NOT NULL AND created_at >= p_to - INTERVAL '30 days' AND created_at < p_to),
    'sessions', (SELECT COUNT(*) FROM sessions),
    'avg_session_seconds', (SELECT COALESCE(ROUND(AVG(secs))::INT, 0) FROM sessions),
    'screen_views', (SELECT COUNT(*) FROM _ev WHERE event = 'screen_view'),
    'impressions', (SELECT COUNT(*) FROM _ev WHERE event = 'impression'),
    'clicks', (SELECT COUNT(*) FROM _ev WHERE event = 'item_click'),
    'searches', (SELECT COUNT(*) FROM _ev WHERE event = 'search_query'),
    'zero_result_searches', (SELECT COUNT(*) FROM _ev
                             WHERE event = 'search_query'
                               AND COALESCE((props->>'deals')::INT, 0) + COALESCE((props->>'businesses')::INT, 0) = 0),
    'saves', (SELECT COUNT(*) FROM _ev WHERE event IN ('deal_saved', 'business_saved')),
    'bookings_requested', (SELECT COUNT(*) FROM _ev WHERE event = 'booking_requested'),
    'referral_shares', (SELECT COUNT(*) FROM _ev WHERE event = 'referral_shared'),
    'waitlist_joins', (SELECT COUNT(*) FROM _ev WHERE event = 'waitlist_joined'),
    'new_users', (SELECT COUNT(*) FROM profiles WHERE created_at >= p_from AND created_at < p_to),
    'redemptions', (SELECT COUNT(*) FROM redemptions WHERE redeemed_at >= p_from AND redeemed_at < p_to),
    'savings', (SELECT COALESCE(SUM(savings_amount), 0) FROM redemptions
                WHERE redeemed_at >= p_from AND redeemed_at < p_to)
  ) INTO v_kpis;

  WITH days AS (
    SELECT generate_series(date_trunc('day', p_from), date_trunc('day', p_to - INTERVAL '1 second'), INTERVAL '1 day') AS day
  ),
  agg AS (
    SELECT date_trunc('day', created_at) AS day,
           COUNT(DISTINCT user_id) FILTER (WHERE user_id IS NOT NULL) AS active_users,
           COUNT(DISTINCT session_id) AS sessions,
           COUNT(*) FILTER (WHERE event = 'screen_view') AS screen_views,
           COUNT(*) FILTER (WHERE event = 'impression') AS impressions,
           COUNT(*) FILTER (WHERE event = 'item_click') AS clicks
    FROM _ev
    GROUP BY 1
  ),
  red AS (
    SELECT date_trunc('day', redeemed_at) AS day, COUNT(*) AS redemptions
    FROM redemptions
    WHERE redeemed_at >= p_from AND redeemed_at < p_to
    GROUP BY 1
  ),
  signups AS (
    SELECT date_trunc('day', created_at) AS day, COUNT(*) AS new_users
    FROM profiles
    WHERE created_at >= p_from AND created_at < p_to
    GROUP BY 1
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'day', to_char(d.day, 'YYYY-MM-DD'),
    'active_users', COALESCE(a.active_users, 0),
    'sessions', COALESCE(a.sessions, 0),
    'screen_views', COALESCE(a.screen_views, 0),
    'impressions', COALESCE(a.impressions, 0),
    'clicks', COALESCE(a.clicks, 0),
    'redemptions', COALESCE(r.redemptions, 0),
    'new_users', COALESCE(s.new_users, 0)
  ) ORDER BY d.day), '[]'::jsonb)
  INTO v_daily
  FROM days d
  LEFT JOIN agg a ON a.day = d.day
  LEFT JOIN red r ON r.day = d.day
  LEFT JOIN signups s ON s.day = d.day;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb ORDER BY t.impressions DESC), '[]'::jsonb)
  INTO v_surfaces
  FROM (
    SELECT props->>'surface' AS surface,
           COUNT(*) FILTER (WHERE event = 'impression') AS impressions,
           COUNT(*) FILTER (WHERE event = 'item_click') AS clicks
    FROM _ev
    WHERE event IN ('impression', 'item_click') AND props ? 'surface'
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 25
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_top_deals
  FROM (
    WITH stats AS (
      SELECT props->>'item_id' AS item_id,
             COUNT(*) FILTER (WHERE event = 'impression') AS impressions,
             COUNT(*) FILTER (WHERE event = 'item_click') AS clicks
      FROM _ev
      WHERE event IN ('impression', 'item_click') AND props->>'item_type' = 'deal'
      GROUP BY 1
    ),
    views AS (
      SELECT props->>'item_id' AS item_id, COUNT(*) AS detail_views
      FROM _ev
      WHERE event = 'screen_view' AND props->>'screen' = 'deal/[id]'
      GROUP BY 1
    ),
    red AS (
      SELECT deal_id::TEXT AS item_id, COUNT(*) AS redemptions
      FROM redemptions
      WHERE redeemed_at >= p_from AND redeemed_at < p_to
      GROUP BY 1
    ),
    ids AS (
      SELECT item_id FROM stats UNION SELECT item_id FROM views UNION SELECT item_id FROM red
    )
    SELECT ids.item_id AS id,
           d.title,
           b.name AS business_name,
           COALESCE(s.impressions, 0) AS impressions,
           COALESCE(s.clicks, 0) AS clicks,
           COALESCE(v.detail_views, 0) AS detail_views,
           COALESCE(r.redemptions, 0) AS redemptions
    FROM ids
    JOIN deals d ON d.id::TEXT = ids.item_id
    LEFT JOIN businesses b ON b.id = d.business_id
    LEFT JOIN stats s ON s.item_id = ids.item_id
    LEFT JOIN views v ON v.item_id = ids.item_id
    LEFT JOIN red r ON r.item_id = ids.item_id
    ORDER BY COALESCE(s.clicks, 0) DESC, COALESCE(v.detail_views, 0) DESC, COALESCE(s.impressions, 0) DESC
    LIMIT 15
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_top_businesses
  FROM (
    WITH stats AS (
      SELECT props->>'item_id' AS item_id,
             COUNT(*) FILTER (WHERE event = 'impression') AS impressions,
             COUNT(*) FILTER (WHERE event = 'item_click') AS clicks
      FROM _ev
      WHERE event IN ('impression', 'item_click') AND props->>'item_type' = 'business'
      GROUP BY 1
    ),
    views AS (
      SELECT props->>'item_id' AS item_id, COUNT(*) AS profile_views
      FROM _ev
      WHERE event = 'screen_view' AND props->>'screen' = 'business/[id]'
      GROUP BY 1
    ),
    ids AS (SELECT item_id FROM stats UNION SELECT item_id FROM views)
    SELECT ids.item_id AS id,
           b.name,
           b.city,
           COALESCE(s.impressions, 0) AS impressions,
           COALESCE(s.clicks, 0) AS clicks,
           COALESCE(v.profile_views, 0) AS profile_views
    FROM ids
    JOIN businesses b ON b.id::TEXT = ids.item_id
    LEFT JOIN stats s ON s.item_id = ids.item_id
    LEFT JOIN views v ON v.item_id = ids.item_id
    ORDER BY COALESCE(s.clicks, 0) DESC, COALESCE(v.profile_views, 0) DESC, COALESCE(s.impressions, 0) DESC
    LIMIT 15
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_top_screens
  FROM (
    SELECT props->>'screen' AS screen,
           COUNT(*) AS views,
           COUNT(DISTINCT user_id) AS users
    FROM _ev
    WHERE event = 'screen_view'
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 15
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_top_searches
  FROM (
    SELECT props->>'query' AS query,
           COUNT(*) AS searches,
           COUNT(*) FILTER (
             WHERE COALESCE((props->>'deals')::INT, 0) + COALESCE((props->>'businesses')::INT, 0) = 0
           ) AS zero_results
    FROM _ev
    WHERE event = 'search_query' AND COALESCE(props->>'query', '') <> ''
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 15
  ) t;

  SELECT COALESCE(jsonb_agg(row_to_json(t)::jsonb), '[]'::jsonb)
  INTO v_platforms
  FROM (
    SELECT COALESCE(platform, 'unknown') AS platform,
           COUNT(DISTINCT session_id) AS sessions,
           COUNT(DISTINCT user_id) AS users
    FROM _ev
    GROUP BY 1
    ORDER BY 2 DESC
  ) t;

  RETURN jsonb_build_object(
    'kpis', v_kpis,
    'daily', v_daily,
    'surfaces', v_surfaces,
    'top_deals', v_top_deals,
    'top_businesses', v_top_businesses,
    'top_screens', v_top_screens,
    'top_searches', v_top_searches,
    'platforms', v_platforms
  );
END;
$$;

REVOKE ALL ON FUNCTION admin_analytics_overview(TIMESTAMPTZ, TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION admin_analytics_overview(TIMESTAMPTZ, TIMESTAMPTZ) TO service_role;
