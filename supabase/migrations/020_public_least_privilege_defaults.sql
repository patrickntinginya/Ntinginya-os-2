-- Migration 020: Public schema least-privilege defaults
-- Remove unnecessary structural privileges from authenticated.
-- Preserve normal application CRUD permissions.

BEGIN;

-- Fix existing public tables.
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON ALL TABLES IN SCHEMA public
FROM authenticated;

-- Fix future tables created by postgres in public.
ALTER DEFAULT PRIVILEGES
FOR ROLE postgres
IN SCHEMA public
REVOKE TRUNCATE, REFERENCES, TRIGGER, MAINTAIN
ON TABLES
FROM authenticated;

COMMIT;
