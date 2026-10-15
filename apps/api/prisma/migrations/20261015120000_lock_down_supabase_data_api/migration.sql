-- Security: the application talks to PostgreSQL only through the NestJS API (role
-- "postgres", table owner with BYPASSRLS). Supabase also exposes the "public" schema
-- through its Data API (PostgREST) to the roles "anon" and "authenticated", which had
-- full privileges (including TRUNCATE) and no Row Level Security on every table.
--
-- This migration is additive and non-destructive: no data, column or table changes.
--   1. Enable RLS with NO policies on every application table: any access through the
--      Data API is denied. The owner role used by Prisma is not affected.
--   2. Revoke all privileges from "anon" and "authenticated" on existing objects.
--   3. Stop granting privileges on future objects created by "postgres" in "public".
-- Role-dependent steps run only where those Supabase roles exist (e.g. not in a plain
-- local PostgreSQL or a shadow database).

ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Patient" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "StaffProfile" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "PsychologistAvailability" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Appointment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CareRelationship" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ClinicalSessionNote" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "_prisma_migrations" ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  data_api_role text;
BEGIN
  FOREACH data_api_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = data_api_role) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', data_api_role);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', data_api_role);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM %I', data_api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM %I', data_api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM %I', data_api_role);
      EXECUTE format('ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM %I', data_api_role);
    END IF;
  END LOOP;
END
$$;
