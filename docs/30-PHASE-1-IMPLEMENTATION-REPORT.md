# 30 — Phase 1 Implementation Report

**Scope delivered:** System foundation · Authentication · Authorization (RBAC +
scope) · University user management · Official student master records · Student
account activation.

**Scope explicitly _not_ started:** all academic modules (course registration,
results, fees, examinations, etc.). These appear in the UI only as clearly
labelled "not available yet" placeholders. **Phase 2 has not been begun.**

---

## 1. Verification status

Run from the repo root unless noted. Results below are from this environment
(no live database is attached here — see §6 for what that gates).

| Check | Command | Result |
|---|---|---|
| API build | `npm run api:build` | ✅ passes |
| API lint | `npm run api:lint` | ✅ 0 errors, 0 warnings |
| API unit tests | `npm run api:test` | ✅ **81 passed**, 9 suites |
| Web typecheck | `tsc --noEmit` (in `apps/web`) | ✅ clean (`noUncheckedIndexedAccess` on) |
| Web lint | `npm run web:lint` | ✅ "No ESLint warnings or errors" |
| Web build | `npm run web:build` | ✅ all 21 routes compiled |
| Import templates | parsed through the real `parseImportFile` | ✅ 4 rows, 16 cols, 0 unknown headers |

DB-backed suites (integration/e2e/security-at-the-DB) require a Postgres
connection and are documented as run-steps in §6, not executed here — no
credentials are present and none were guessed or hardcoded.

---

## 2. Files created / modified

Counts: **61** API source files (+9 spec files, 1 e2e harness), **32** web
source files across **21** pages. Highlights by area:

**Foundation & config**
- `package.json` (workspaces + scripts), `apps/api`, `apps/web` scaffolding.
- `.env.example` — every secret externalized; nothing hardcoded.
- `.gitignore` — excludes `.env`, build output, `node_modules`.

**Database (identity invariant)**
- `apps/api/prisma/schema.prisma` (546 lines) — full domain model.
- `apps/api/prisma/migrations/20260809000000_init/migration.sql` (516 lines).
- `apps/api/prisma/guards.sql` — triggers, `SECURITY DEFINER` amend function,
  separation-of-duties CHECK, partial/functional unique indexes, least-privilege
  grants, internal `student_id` sequence.
- `apps/api/prisma/seed.ts` (440 lines) — idempotent; roles/permissions,
  bootstrap `SUPER_ADMIN` from env, status vocabulary, demo structure.

**API modules** — `auth`, `rbac`, `users` (+ `roles`), `structure`, `students`
(+ `import`, `activation`, `profile`), `audit`, `dashboards`, plus `common`
(guards, crypto, envelope interceptor, auth-principal).

**Web** — App-Router pages for login/activation, dashboards, staff accounts,
roles & permissions, university structure (+ manage), students (list/detail/new/
import), change-request review, student self-service (`/me/*`), and the
"other modules" placeholder; shared `lib/` (api client, session, permissions,
types) and `components/` (app shell, ui, page, pagination).

**Docs / templates (this task)**
- `README.md`, `docs/28-DEV-SETUP.md`, this report.
- `docs/templates/student-import-template.{csv,xlsx}` and copies under
  `apps/web/public/templates/` (linked for download from the import screen).

---

## 3. Database changes

- **Protected identity columns** on `student_records`: matric no., jamb reg no.,
  student id, surname, first/other names, DOB, gender, faculty/department/
  programme, admission session, entry mode, level, status.
- **`trg_guard_student_record`** — `BEFORE UPDATE` trigger rejects any protected
  change unless `eportal.amendment_id` is set for the transaction.
- **`eportal_amend_student(uuid, jsonb, text, uuid)`** — the only path that may
  set that GUC; `SECURITY DEFINER`, whitelists amendable columns, and refuses the
  immutable `student_id`/`matriculation_number`.
- **Append-only audit** — `audit_events` blocks UPDATE/DELETE via trigger; app
  role granted only SELECT/INSERT.
- **Separation of duties** — `chk_change_request_sod` CHECK: a reviewer cannot be
  the requester.
- **Uniqueness** — case-insensitive matric (`uq_matric_ci`), single current
  session (`uq_one_current_session` partial index).
- **Least privilege** — `eportal_app` loses UPDATE on protected columns and
  UPDATE/DELETE on audit; retains only what it needs.

## 4. API endpoints (base `/api/v1`)

**Auth** `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` ·
`GET /auth/me` · `POST /auth/change-password` · `POST /auth/forgot-password` ·
`POST /auth/reset-password`

**Users & roles** `GET/POST /users` · `GET/PATCH /users/:id` ·
`POST /users/:id/set-active` · `POST /users/:id/reset-password` ·
`POST /users/:id/roles` · `DELETE /users/:id/roles/:assignmentId` ·
`GET/POST /roles` · `GET /permissions`

**Structure** `GET /structure/tree|faculties|departments|programmes|sessions` ·
`POST /structure/faculties|departments|programmes|sessions` ·
`POST /structure/sessions/:id/set-current`

**Students** `POST /students` · `GET /students` · `GET /students/statuses` ·
`GET /students/:id` · `PATCH /students/:id` · `POST /students/:id/status` ·
`POST /students/import/preview` · `POST /students/import/commit`

**Activation** `POST /students/activate/identify|verify|set-password`

**Student self-service** `GET/PATCH /me/profile` ·
`GET/POST /me/change-requests` · `POST /me/change-requests/:id/cancel`

**Change-request review** `GET /change-requests` ·
`POST /change-requests/:id/review`

**Dashboards** `GET /dashboards/admin` · `GET /dashboards/me`

**Ops** `GET /health` · `GET /admin/audit`

Every protected route is guarded by `JwtAuthGuard` + `PermissionsGuard`;
student self-service routes authorize by **ownership** (linked
`studentRecordId`), not permissions.

## 5. Features

- Argon2id passwords; short-lived JWT access cookie + DB-backed opaque refresh
  cookie; forced password rotation for bootstrap and admin-reset accounts.
- Hybrid **RBAC + scope** (GLOBAL → FACULTY → DEPARTMENT → PROGRAMME). Scope never
  lives in role names. **Grant authority**: an actor may assign only roles whose
  permissions are a subset of their own, at their scope or narrower; the UI mirrors
  this (un-grantable roles disabled) but the **server enforces it**.
- Official student records created only by authorized staff or bulk import.
  **Bulk import** is two-phase (preview → commit), all-or-nothing while any row is
  in error, with **row-level** error/warning reporting — no silent drops.
- Student **activation** (identify → verify → set password) links a person to an
  existing official record; students cannot self-register official accounts.
- Protected-field **change requests** with separation-of-duties review; approvals
  applied as audited amendments through the single protected-write path.
- **Real** dashboard metrics (counts come from the database; nothing fabricated).
- Cross-cutting **audit logging**; standard success/error envelope with request ids.

## 6. Tests created / passed

- **81 unit tests, 9 suites, all passing.** Coverage centers on the security-
  critical policy that is verifiable without a DB: `validateMasterInput` cross-
  field rules (shared by single-create and import), `assertMatricAvailable`
  duplicate pre-check, `applyProtectedAmendment` refusing non-amendable and
  immutable fields, `listStatuses`, RBAC subset/scope checks, `PermissionsGuard`,
  password/crypto utilities, activation, profile, and import parsing.
- **DB-backed tests (integration/e2e/security) — run-steps, not executed here.**
  The harness (`apps/api/test/jest-e2e.json`) is in place. To run against a
  disposable database:
  ```bash
  DATABASE_URL="$DATABASE_ADMIN_URL" npm run prisma:deploy
  psql "$DATABASE_ADMIN_URL" -f apps/api/prisma/guards.sql
  npm run api:test:e2e
  ```
  These are the checks that must pass before production: the guard trigger
  actually rejects a direct protected UPDATE; the app role cannot UPDATE protected
  columns or mutate audit; the SoD CHECK blocks self-review; case-insensitive
  matric uniqueness holds under concurrency.

## 7. Known limitations

- Integration/e2e/security tests are written as run-steps and have **not** been
  executed in this environment (no database). They must be run before shipping.
- Rate limiting is in-process (single node). Horizontal scale needs a shared
  store (Redis) — noted in `.env.example` and the architecture blueprint.
- Profile-photo storage defaults to local disk (`UPLOAD_DRIVER=local`); production
  should use S3-compatible storage.
- Custom-role _creation_ UI is intentionally omitted from Phase 1 (the API exists;
  the catalog is read-only in the web app).
- The seeded university structure is demo data for local development, provisioned
  by the idempotent seed — not production data.

## 8. Security considerations

- **Identity invariant enforced in four layers** (schema, DB trigger + SECURITY
  DEFINER, service, API DTOs) — never in the frontend.
- **No hardcoded secrets or credentials**; all externalized to `.env` (git-ignored).
  The bootstrap admin comes from env and is forced to rotate on first login.
- **Frontend route hiding is UX only.** Every protected endpoint re-verifies
  authorization server-side; student self-service authorizes by ownership.
- **Least privilege**: the application DB role cannot write protected identity
  columns or alter the audit trail; admins cannot grant permissions they lack.
- **Separation of duties** enforced in both the service and a DB CHECK.
- Matric uniqueness is a **database constraint** (case-insensitive), not just an
  app check. Activation does not treat matric number as sufficient authentication.
- Error messages avoid confirming the existence of specific student records to
  unauthorized callers.

## 9. Recommended next phase

**Phase 2 — Academic structure in motion: Course catalogue & registration.**
It is the natural next layer: it consumes the now-authoritative identity + program
structure, exercises scope-based authorization against real per-department data,
and unlocks the modules currently shown as placeholders. Suggested slice:
course/curriculum definition, semester course allocation, and student course
registration with capacity and eligibility rules — each with the same four-layer
enforcement discipline established here.

> Per the standing directive, work stops at the end of Phase 1. Phase 2 begins
> only on explicit instruction.
