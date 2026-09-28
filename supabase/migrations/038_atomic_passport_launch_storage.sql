-- 038: atomic passport counters, one-time market launch fan-out, storage upload limits.

-- ── Passport: atomic stamp + credit functions (service role only) ────────────

CREATE OR REPLACE FUNCTION passport_add_stamp(p_user_id UUID, p_per_reward INT)
RETURNS passport_progress
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  row passport_progress;
BEGIN
  INSERT INTO passport_progress (user_id, stamps_count, rewards_unlocked, last_stamp_at, updated_at)
  VALUES (p_user_id, 1, CASE WHEN p_per_reward <= 1 THEN 1 ELSE 0 END, NOW(), NOW())
  ON CONFLICT (user_id) DO UPDATE
    SET stamps_count = passport_progress.stamps_count + 1,
        rewards_unlocked = (passport_progress.stamps_count + 1) / GREATEST(p_per_reward, 1),
        last_stamp_at = NOW(),
        updated_at = NOW()
  RETURNING * INTO row;
  RETURN row;
END;
$$;

CREATE OR REPLACE FUNCTION passport_consume_credit(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  n INT;
BEGIN
  UPDATE profiles
     SET passport_redemption_credits = passport_redemption_credits - 1
   WHERE id = p_user_id AND passport_redemption_credits > 0;
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n > 0;
END;
$$;

CREATE OR REPLACE FUNCTION passport_claim_grant(p_user_id UUID, p_grant_id UUID)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  g passport_reward_grants;
  credits INT;
BEGIN
  UPDATE passport_reward_grants
     SET status = 'claimed', claimed_at = NOW()
   WHERE id = p_grant_id AND user_id = p_user_id AND status = 'available'
  RETURNING * INTO g;

  IF g.id IS NULL THEN
    IF EXISTS (SELECT 1 FROM passport_reward_grants WHERE id = p_grant_id AND user_id = p_user_id) THEN
      RAISE EXCEPTION 'This reward was already claimed';
    END IF;
    RAISE EXCEPTION 'Reward not found';
  END IF;

  UPDATE profiles
     SET passport_redemption_credits = passport_redemption_credits + 1
   WHERE id = p_user_id
  RETURNING passport_redemption_credits INTO credits;

  RETURN jsonb_build_object('grant', to_jsonb(g), 'passport_redemption_credits', credits);
END;
$$;

REVOKE ALL ON FUNCTION passport_add_stamp(UUID, INT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION passport_consume_credit(UUID) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION passport_claim_grant(UUID, UUID) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION passport_add_stamp(UUID, INT) TO service_role;
GRANT EXECUTE ON FUNCTION passport_consume_credit(UUID) TO service_role;
GRANT EXECUTE ON FUNCTION passport_claim_grant(UUID, UUID) TO service_role;

-- ── Markets: launch notifications go out once per market ─────────────────────

ALTER TABLE markets ADD COLUMN IF NOT EXISTS launch_notified_at TIMESTAMPTZ;

-- Markets already live have had (or never needed) their announcement.
UPDATE markets SET launch_notified_at = COALESCE(updated_at, NOW())
 WHERE is_launched = true AND launch_notified_at IS NULL;

-- ── Storage: size + type limits on the upload bucket ─────────────────────────
-- One bucket holds photos and Media Hub videos, so the bucket cap fits video;
-- image folders are capped tighter by extension in the insert policy below.

UPDATE storage.buckets
   SET file_size_limit = 104857600, -- 100 MB
       allowed_mime_types = ARRAY[
         'image/jpeg', 'image/png', 'image/webp',
         'video/mp4', 'video/quicktime', 'video/webm'
       ]
 WHERE id = 'deal-images';

DROP POLICY IF EXISTS "Authenticated users upload own deal images" ON storage.objects;
CREATE POLICY "Authenticated users upload own deal images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'deal-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
  AND (
    (
      (storage.foldername(name))[2] IN ('deals', 'avatar', 'logo', 'cover', 'media-thumbs')
      AND lower(storage.extension(name)) IN ('jpg', 'jpeg', 'png', 'webp')
    )
    OR (
      (storage.foldername(name))[2] = 'media-videos'
      AND lower(storage.extension(name)) IN ('mp4', 'mov', 'webm')
    )
  )
);

DROP POLICY IF EXISTS "Users delete own deal images" ON storage.objects;
CREATE POLICY "Users delete own deal images"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'deal-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
