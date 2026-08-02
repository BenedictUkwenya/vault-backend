-- Curated Media posts (one row = one creative; platforms are outbound links only)
CREATE TABLE IF NOT EXISTS media_posts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  title TEXT NOT NULL,
  caption TEXT,
  thumbnail_url TEXT,
  video_url TEXT,
  video_provider TEXT NOT NULL DEFAULT 'youtube'
    CHECK (video_provider IN ('youtube', 'file', 'external')),
  platforms JSONB NOT NULL DEFAULT '[]'::jsonb,
  published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_published BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_media_posts_published
  ON media_posts(is_published, sort_order, published_at DESC);
