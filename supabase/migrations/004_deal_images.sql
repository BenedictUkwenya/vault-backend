-- Deal gallery images + public storage bucket for uploads from mobile

ALTER TABLE deals ADD COLUMN IF NOT EXISTS images TEXT[] DEFAULT '{}';

INSERT INTO storage.buckets (id, name, public)
VALUES ('deal-images', 'deal-images', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated users upload own deal images" ON storage.objects;
CREATE POLICY "Authenticated users upload own deal images"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'deal-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Users update own deal images" ON storage.objects;
CREATE POLICY "Users update own deal images"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'deal-images'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "Public read deal images" ON storage.objects;
CREATE POLICY "Public read deal images"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'deal-images');
