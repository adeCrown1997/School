# 28 — Developer Setup & Run Guide (Phase 1)

This guide takes a fresh checkout to a running ePortal with the identity guards
in place. Everything here is Phase 1 only (foundation, identity, auth, RBAC).

## Prerequisites

- Node.js 20 LTS and npm 10+
- PostgreSQL 16+ (local or container)
- `psql` on your PATH (used once to apply the database guards)

## 1. Install

```bash
npm install
```

This installs both workspaces (`apps/api`, `apps/web`) from the root.

## 2. Configure environment

```bash
cp .env.example .env
```

Then edit `.env`:

- Generate the JWT secret:
  ```bash
  node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
  ```
- Set `DATABASE_URL` to the **least-privilege application role** (`eportal_app`).
- Set `DATABASE_ADMIN_URL` to a role that **owns** the tables (used only for
  migrations and installing the guards).
- Set the `BOOTSTRAP_ADMIN_*` values — the seed provisions exactly one
  `SUPER_ADMIN` from these and nothing is hardcoded.

Never commit `.env`. It is already covered by `.gitignore`.

## 3. Create database roles

Connect as a superuser once and create the two roles referenced above:

```sql
CREATE ROLE eportal_owner LOGIN PASSWORD 'CHANGE_ME';
CREATE ROLE eportal_app   LOGIN PASSWORD 'CHANGE_ME';
CREATE DATABASE eportal OWNER eportal_owner;
\c eportal
GRANT USAGE ON SCHEMA public TO eportal_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eportal_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eportal_app;
```

`guards.sql` later **revokes** the too-broad UPDATE on `student_records` and the
UPDATE/DELETE on `audit_events`, replacing them with column-level grants — so the
broad grant above is only a starting point that the guards tighten.

## 4. Apply schema + guards

Run migrations with the **owner** connection, then install the guards (Layer 2
of the identity invariant) against the same database:

```bash
# 1) schema
npm run prisma:generate
DATABASE_URL="$DATABASE_ADMIN_URL" npm run prisma:deploy

# 2) guards (triggers, SECURITY DEFINER amend fn, SoD CHECK, unique indexes, grants)
psql "$DATABASE_ADMIN_URL" -f apps/api/prisma/guards.sql
```

`guards.sql` is idempotent — safe to re-run after any migration. It must run
**after** each migration because a migration can recreate tables and drop
triggers.

## 5. Seed

```bash
npm run seed
```

The seed is idempotent (upserts). It creates: the permission catalog and system
roles, one bootstrap `SUPER_ADMIN` (from `.env`), the student-status vocabulary,
and a small demo university structure (faculties SCI/ENG, departments CSC/MTH/EEE,
programmes, and the `2024/2025` session). It creates **no** student records —
those come from the authorized create/import flows.

## 6. Run

```bash
npm run api:dev   # NestJS on http://localhost:4000  (API base: /api/v1)
npm run web:dev   # Next.js on http://localhost:3000
```

Log in at http://localhost:3000 with the bootstrap admin, then rotate its
password immediately (the account is flagged `mustChangePassword`).

## 7. Verify the build

```bash
npm run api:build && npm run api:lint && npm run api:test
npm run web:build && npm run web:lint
```

See [30-PHASE-1-IMPLEMENTATION-REPORT.md](30-PHASE-1-IMPLEMENTATION-REPORT.md)
for the current verification status and the DB-backed test run-steps.

## Bulk import templates

Starter files live in [`docs/templates/`](templates/) and are also served by the
web app for download from the import screen:

- `student-import-template.csv`
- `student-import-template.xlsx`

Required columns: `matriculationNumber, surname, firstName, dateOfBirth,
facultyCode, departmentCode, programmeCode, admissionSession, currentLevel`.
Optional: `jambRegistrationNumber, otherNames, gender, entryMode, statusKey,
officialEmail, officialPhone`. Headers are matched case/space/underscore
-insensitively; unknown columns are reported, not fatal.
