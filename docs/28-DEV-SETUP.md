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
and — unless `NODE_ENV=production` or `SEED_DEMO=false` — a small demo university
(faculties SCI/ENG, departments CSC/MTH/EEE, programmes, the `2024/2025` session)
plus **PENDING demo student records**. Those students cannot sign in until they
activate at `/activate`.

Demo students (activation factors = matric + date of birth + surname; initial
password after activation is the surname):

| Matriculation number | Surname | Date of birth |
| -------------------- | ------- | ------------- |
| `CSC/2024/001`       | Adeyemi | 2005-03-14    |
| `CSC/2024/002`       | Okoro   | 2004-11-02    |
| `MTH/2024/003`       | Ibrahim | 2005-07-21    |
| `EEE/2024/004`       | Balogun | 2003-12-09    |

## 6. Run

Start **both** processes (login talks from the browser on :3000 to the API on :4000):

```bash
npm run api:dev   # NestJS on http://localhost:4000  (API base: /api/v1)
npm run web:dev   # Next.js on http://localhost:3000
```

Open **http://localhost:3000** (not `127.0.0.1` — CORS and cookies are bound to `WEB_ORIGIN`).

### Staff / admin

1. Go to http://localhost:3000/login/staff
2. Identifier: the value of `BOOTSTRAP_ADMIN_EMAIL` in `.env`
3. Password: the value of `BOOTSTRAP_ADMIN_PASSWORD` in `.env`
4. On first login the account is flagged `mustChangePassword` — set a new password (at least 12 characters, mixed case, digit, symbol). After that, the env password no longer works; use the password you chose.

`BOOTSTRAP_ADMIN_PASSWORD` must be at least 12 characters or the API will refuse to start.

### Student

Demo students are seeded **PENDING**. They have no login until activation:

1. Go to http://localhost:3000/activate
2. Enter a demo matriculation number, that student's date of birth, and surname (table above)
3. Sign in at http://localhost:3000/login/student with the **matriculation number** and the **surname** as the initial password
4. You will be sent to `/change-password`. After you set a permanent password, the surname no longer works.

There is no student self-registration. Staff accounts are created by an administrator.

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
