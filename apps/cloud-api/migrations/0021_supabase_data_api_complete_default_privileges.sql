-- Complete the future-object least-privilege boundary started in 0020.
--
-- Supabase's schema-specific defaults can include table privileges beyond CRUD
-- (for example TRUNCATE, REFERENCES, TRIGGER and MAINTAIN) and sequence UPDATE.
-- Revoking only a subset would allow future application objects to become
-- partially reachable by Data API roles again. Use ALL PRIVILEGES for future
-- tables and sequences so exposure remains explicitly opt-in.

DO $$
DECLARE
  api_role text;
  migration_owner text := current_user;
BEGIN
  FOREACH api_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role']
  LOOP
    IF to_regrole(api_role) IS NULL THEN
      CONTINUE;
    END IF;

    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM %I',
      migration_owner,
      api_role
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM %I',
      migration_owner,
      api_role
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM %I',
      migration_owner,
      api_role
    );
  END LOOP;
END
$$;
