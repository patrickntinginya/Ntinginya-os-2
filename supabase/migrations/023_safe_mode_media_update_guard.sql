BEGIN;

CREATE OR REPLACE FUNCTION public.safe_mode_media_guard_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
BEGIN
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.media_type IS DISTINCT FROM OLD.media_type
     OR NEW.visibility IS DISTINCT FROM OLD.visibility
     OR NEW.storage_path IS DISTINCT FROM OLD.storage_path
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'safe_mode_media_metadata_immutable'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.safe_mode_media_guard_update()
FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS safe_mode_media_guard_update
ON public.safe_mode_media;

CREATE TRIGGER safe_mode_media_guard_update
BEFORE UPDATE ON public.safe_mode_media
FOR EACH ROW
EXECUTE FUNCTION public.safe_mode_media_guard_update();

COMMIT;
