-- Saved deals for later (mirrors user_favorites for businesses).

CREATE TABLE IF NOT EXISTS user_deal_favorites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, deal_id)
);

CREATE INDEX IF NOT EXISTS idx_deal_favorites_user ON user_deal_favorites(user_id);

ALTER TABLE user_deal_favorites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own deal favorites"
  ON user_deal_favorites FOR ALL
  USING (auth.uid() = user_id);

CREATE POLICY "Service role full access deal favorites"
  ON user_deal_favorites
  USING (auth.role() = 'service_role');
