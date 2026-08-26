-- Event Commerce OS uses the NestJS Cloud API over a direct PostgreSQL connection.
-- Supabase's generated Data API (PostgREST / GraphQL) is not an application boundary.
--
-- RLS-without-policies already denies rows to Supabase API roles. This migration
-- adds the independent PostgreSQL grant layer recommended by Supabase so those
-- roles cannot reach application tables, views, sequences or functions at all.
--
-- Keep this migration portable to ordinary PostgreSQL used by CI: the Supabase
-- roles do not exist there, so role-specific revokes are conditional.

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
      'REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I',
      api_role
    );
    EXECUTE format(
      'REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I',
      api_role
    );
    EXECUTE format(
      'REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM %I',
      api_role
    );

    -- Stop future application objects created by the migration owner from being
    -- auto-exposed through Supabase's default privileges.
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE SELECT, INSERT, UPDATE, DELETE ON TABLES FROM %I',
      migration_owner,
      api_role
    );
    EXECUTE format(
      'ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE USAGE, SELECT ON SEQUENCES FROM %I',
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

-- PostgreSQL grants EXECUTE on new functions to PUBLIC by default. Application
-- helper/trigger functions are not public RPC endpoints, so remove that path too.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
