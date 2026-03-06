-- Enable Supabase Storage bucket for recipe images and fix the missing
-- unique index on image_jobs that prevented job enqueue from working.

-- Storage bucket: public read, service-role write
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('recipe-images', 'recipe-images', true, 10485760)
ON CONFLICT DO NOTHING;

-- Idempotent policy creation: drop first to avoid "already exists" errors
-- if applied after a manual hotfix.
DROP POLICY IF EXISTS "Public read recipe images" ON storage.objects;
CREATE POLICY "Public read recipe images"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'recipe-images');

DROP POLICY IF EXISTS "Service role insert recipe images" ON storage.objects;
CREATE POLICY "Service role insert recipe images"
  ON storage.objects FOR INSERT TO service_role
  WITH CHECK (bucket_id = 'recipe-images');

-- The image_jobs.image_request_id column requires a unique index for the
-- upsert in enqueueImageRequestJob to resolve the ON CONFLICT target.
CREATE UNIQUE INDEX IF NOT EXISTS image_jobs_image_request_id_key
  ON image_jobs (image_request_id);
