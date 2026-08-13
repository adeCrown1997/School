# University ePortal — Phase 1

A production-grade university portal. **Phase 1** delivers the foundation the rest
of the platform is built on: system foundation, authentication, authorization
(RBAC + scope), university user management, official student master records, and
student account activation. Later academic modules (registration, results, fees,
etc.) are intentionally shown as **not yet available** in the UI — they are not
faked.

## The one rule everything else protects

**The university is the source of truth for student identity.** A student can
never create their own official record or invent/modify their matriculation
number, student id, programme, department, faculty, admission session, level, or
academic status. This is enforced in **four layers**, not in the frontend:

1. **Schema (L1)** — protected columns + least-privilege column grants.
2. **Database (L2)** — a `BEFORE UPDATE` trigger rejects any change to a protected
   field unless an approved amendment is in progress; the only write path is a
   `SECURITY DEFINER` function. Audit is append-only. See
   [`apps/api/prisma/guards.sql`](apps/api/prisma/guards.sql).
3. **Service (L3)** — `applyProtectedAmendment` is the sole protected-write path.
4. **API (L4)** — student-facing DTOs cannot even express a protected field.

The frontend gates navigation for UX only; **every protected endpoint
independently verifies authorization**.

## Stack

- **Monorepo**: npm workspaces.
- **`apps/api`**: NestJS 10, Prisma, PostgreSQL 16+. JWT access cookie (short-lived)
  + DB-backed opaque refresh cookie; argon2id password hashing.
- **`apps/web`**: Next.js 14 (App Router), React 18, Tailwind, zod.
- **API contract**: base `/api/v1`; success `{ok:true,data,meta?}`,
  error `{ok:false,error:{code,message,details?,requestId}}`.

## Quickstart

```bash
npm install
cp .env.example .env   # then fill in real values — see docs/28-DEV-SETUP.md
```

Provision the database, apply schema + guards, seed, then run:

```bash
npm run prisma:deploy                              # schema (owner connection)
psql "$DATABASE_ADMIN_URL" -f apps/api/prisma/guards.sql   # identity guards
npm run seed                                       # roles, bootstrap admin, demo structure
npm run api:dev                                    # http://localhost:4000
npm run web:dev                                    # http://localhost:3000
```

Open **http://localhost:3000** (not `127.0.0.1`). Sign in as staff at `/login/staff`
with `BOOTSTRAP_ADMIN_EMAIL` / `BOOTSTRAP_ADMIN_PASSWORD` from `.env`. Demo students
must first activate at `/activate` (see [docs/28-DEV-SETUP.md](docs/28-DEV-SETUP.md)),
then sign in at `/login/student` with their matriculation number and surname.

Full step-by-step (including database roles and secret generation) is in
[docs/28-DEV-SETUP.md](docs/28-DEV-SETUP.md).

## Documentation

- [docs/00-SPEC-PROVENANCE.md](docs/00-SPEC-PROVENANCE.md) — where each requirement came from.
- [docs/01-OPEN-QUESTIONS.md](docs/01-OPEN-QUESTIONS.md) — ambiguities and the decisions taken.
- [docs/02-ARCHITECTURE.md](docs/02-ARCHITECTURE.md) — the approved architecture blueprint.
- [docs/03-WORKFLOWS.md](docs/03-WORKFLOWS.md) — academic workflows.
- [docs/04-PLATFORM.md](docs/04-PLATFORM.md) — cross-cutting platform concerns.
- [docs/28-DEV-SETUP.md](docs/28-DEV-SETUP.md) — setup & run guide.
- [docs/30-PHASE-1-IMPLEMENTATION-REPORT.md](docs/30-PHASE-1-IMPLEMENTATION-REPORT.md) — what shipped, tests, limitations.

## Verify

```bash
npm run api:build && npm run api:lint && npm run api:test
npm run web:build && npm run web:lint
```

## Scope discipline

Phase 1 stops at identity + access. No academic module logic is implemented, and
the UI does not pretend otherwise. See the implementation report for the
recommended next phase.
