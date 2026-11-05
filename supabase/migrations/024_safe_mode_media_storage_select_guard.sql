BEGIN;

DROP POLICY IF EXISTS safe_mode_media_storage_select
ON storage.objects;

CREATE POLICY safe_mode_media_storage_select
ON storage.objects
FOR SELECT
TO authenticated
USING (
    bucket_id = 'safe-mode-media'
    AND EXISTS (
        SELECT 1
        FROM public.safe_mode_media AS media
        WHERE media.storage_path = name
          AND (
              (
                  (storage.foldername(name))[1] = auth.uid()::text
                  AND media.user_id = auth.uid()
              )
              OR
              (
                  (storage.foldername(name))[1] = 'shared'
                  AND media.visibility = 'shared'
              )
          )
    )
);

COMMIT;
