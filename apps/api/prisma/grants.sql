-- Privilege baseline for the ePortal database.
--
-- Run as superuser against the `eportal` database, BEFORE migrations. The
-- ALTER DEFAULT PRIVILEGES clauses are what make this work: they apply to
-- tables created LATER by eportal_owner (i.e. by `prisma migrate deploy`),
-- so the app role picks up rights on every migrated table automatically
-- rather than needing a re-grant after each migration.
--
-- These grants are deliberately BROAD. guards.sql runs afterwards and takes
-- back what must not be broad — UPDATE on student_records (replaced with
-- column-level grants that exclude the protected identity fields) and
-- UPDATE/DELETE on audit_events and the append-only ledgers.

-- The migrator owns the schema and creates everything in it.
ALTER SCHEMA public OWNER TO eportal_owner;

-- The application role may use the schema but never create in it: DDL is the
-- migrator's job alone, so a compromised app credential cannot alter shape.
GRANT USAGE ON SCHEMA public TO eportal_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM eportal_app;

-- Future tables/sequences created by the migrator.
ALTER DEFAULT PRIVILEGES FOR ROLE eportal_owner IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eportal_app;
ALTER DEFAULT PRIVILEGES FOR ROLE eportal_owner IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO eportal_app;
-- EXECUTE on functions is needed for the SECURITY DEFINER amendment path
-- (eportal_amend_student) — the only route by which a protected field moves.
ALTER DEFAULT PRIVILEGES FOR ROLE eportal_owner IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO eportal_app;

-- Anything that already exists (nothing on a fresh database, but this makes
-- the script safe to re-run after a migration).
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eportal_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eportal_app;

-- The app role must not be able to escalate by connecting as the owner.
REVOKE ALL ON DATABASE eportal FROM PUBLIC;
GRANT CONNECT ON DATABASE eportal TO eportal_app;
GRANT CONNECT ON DATABASE eportal TO eportal_owner;
