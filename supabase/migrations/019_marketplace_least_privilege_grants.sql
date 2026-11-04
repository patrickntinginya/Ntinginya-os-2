-- Migration 019: Marketplace least-privilege grants
-- Fix excessive direct table privileges for authenticated.
-- Preserves existing data, RLS policies, triggers and functions.

BEGIN;

REVOKE ALL PRIVILEGES
ON TABLE
    public.marketplace_professionals,
    public.marketplace_services,
    public.marketplace_appointments
FROM authenticated;

-- Professionals
GRANT SELECT, INSERT, UPDATE
ON TABLE public.marketplace_professionals
TO authenticated;

-- Services
GRANT SELECT, INSERT, UPDATE, DELETE
ON TABLE public.marketplace_services
TO authenticated;

-- Appointments
GRANT SELECT, INSERT, UPDATE
ON TABLE public.marketplace_appointments
TO authenticated;

COMMIT;
