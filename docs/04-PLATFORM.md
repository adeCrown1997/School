# ePortal Blueprint — Part 3: Platform Architecture (§15–§23)

> Continues `03-WORKFLOWS.md`. `Q-nn` → `01-OPEN-QUESTIONS.md`; `Rn` → `00-SPEC-PROVENANCE.md`.

---

# §15 API Architecture

## 15.1 Style

**Decision: REST over HTTP/JSON, versioned at the path (`/api/v1`).**

GraphQL is rejected here: this system's dominant risk is *authorisation correctness*, and
GraphQL's flexible field selection makes per-field authorisation and audit substantially harder
to reason about. Predictable, individually-authorised endpoints are the right trade.

## 15.2 Surface segregation — the invariant at the API layer (L4, §0)

The API is split into audience-scoped surfaces that **do not share DTOs**:

```
/api/v1/student/**    ← student principals. DTOs physically cannot express protected fields
/api/v1/staff/**      ← staff principals, permission + scope checked per endpoint
/api/v1/admin/**      ← administrative operations, MFA-required, all audited
/api/v1/public/**     ← unauthenticated: credential verification, course catalogue
/api/v1/webhooks/**   ← provider callbacks, signature-verified, no session auth
```

This is not cosmetic. A shared `StudentDto` with server-side field filtering means one missed
condition leaks or accepts a protected field. Separate types make the vulnerability
*unrepresentable* — the student-facing update DTO has no `matriculationNumber` property to bind.

Illustrative contract shapes:

```
PATCH /api/v1/student/profile
  accepts ONLY: phone, contactAddress, nextOfKin, emergencyContact
  → any unknown/protected key is rejected (strict schema, no passthrough)

# There is deliberately NO endpoint of the form:
#   PATCH /api/v1/student/record
#   POST  /api/v1/student/register        (account self-signup)
```

## 15.3 Core endpoints (abridged)

| Method | Path | Auth | Notes |
|---|---|---|---|
| `POST` | `/auth/activate/identify` | none | Rate-limited, constant-time, no data echoed (§6.4 Step 1) |
| `POST` | `/auth/activate/verify` | none | Consumes activation token |
| `POST` | `/auth/activate/complete` | token | Binds user↔record, once (INV-1) |
| `POST` | `/auth/login` | none | Lockout + backoff |
| `POST` | `/auth/refresh` | cookie | Rotation with reuse detection |
| `GET` | `/student/record` | STUDENT | **Read-only.** No write counterpart exists |
| `PATCH` | `/student/profile` | STUDENT | Class-S fields only |
| `GET` | `/student/registration/available` | STUDENT | Cached; carryovers pre-selected |
| `POST` | `/student/registration` | STUDENT | Idempotency-Key **required** (§9.5) |
| `GET` | `/student/results` | STUDENT | Published, non-superseded only |
| `POST` | `/student/payments/intent` | STUDENT | Creates RRR / gateway intent |
| `POST` | `/staff/scores/:offeringId` | LECTURER | Scope-checked to allocation |
| `POST` | `/staff/results/:batchId/advance` | stage role | N-stage pipeline (§10.4) |
| `POST` | `/admin/students/import` | REGISTRAR | Dry-run first; second approver required |
| `POST` | `/admin/students/:id/amendment` | REGISTRAR | Dual control (§7.6) |
| `GET` | `/public/verify/:code` | none | Selective disclosure only (§13.3) |
| `POST` | `/webhooks/payments/:provider` | signature | Idempotent; never trusts the client |

## 15.4 Cross-cutting API rules

- **Idempotency-Key** on every non-GET mutation; replays return the original result
- **Optimistic concurrency** via `If-Match`/`ETag` on editable resources
- **Cursor pagination** (never `OFFSET` on large tables)
- **RFC 7807 problem+json** errors with a stable machine-readable `code` — the UI must be able
  to say *"Library: 1 book outstanding"*, not *"400 Bad Request"* (§14.1)
- **Tiered rate limits** per principal type and per endpoint class; auth and activation are the
  strictest
- **No enumeration**: identical responses and timing for existent/non-existent identifiers
- **OpenAPI generated from code**, not maintained by hand
- Every response carries a correlation id, propagated to audit and logs

## 15.5 Integration APIs

Outbound: payment providers (§11.3), NYSC/NERD export (`Q-19`), email/SMS (§18), optional
LDAP/AD for staff SSO (`Q-20`), optional NELFUND (`Q-39`).

Inbound (Phase 3+): a scoped, key-authenticated API for institutional systems (library, hostel)
to query enrolment status — **read-only, never a write path into student records**.

---

# §16 Frontend Architecture

## 16.1 The binding constraint: network conditions

This is the design driver that most SIS projects get wrong. Nigerian students commonly access
portals on mobile data with intermittent connectivity, on mid/low-end Android devices, and during
massive contention spikes (`R12`). A heavy SPA that ships 2 MB of JavaScript before rendering a
matric number is a failure regardless of how good it looks on the developer's machine.

**Consequences, non-negotiable:**

| Rule | Target |
|---|---|
| Server-render the critical path | First contentful paint on 3G ≤ 3 s |
| Initial JS budget | ≤ 150 KB gzipped for the student dashboard |
| Route-level code splitting | Registration bundle never ships to a results-only visit |
| Optimistic UI + retry | Assume the connection drops mid-submit |
| Idempotent submissions | Double-tap on a slow link must not double-register (§9.5) |
| Explicit offline/failure states | Never an infinite spinner |
| Works without JS for critical reads | Results and registration slip remain viewable |

Performance budgets are **enforced in CI** (§21) — a budget nobody measures is a wish.

## 16.2 Structure

```
app/
  (public)/          landing, verification, catalogue
  (auth)/            login, activation ceremony, recovery
  (student)/         dashboard, registration, results, payments, clearance
  (staff)/           allocations, score entry, approvals, dashboards
  (admin)/           imports, amendments, config, audit
components/
  ui/                owned primitives — button, field, table, dialog
  domain/            GradeTable, RegistrationCart, ClearanceTracker, PaymentStatus
lib/
  api/               typed client generated from OpenAPI
  auth/              session, permission-aware rendering
  validation/        schemas SHARED with the backend — one definition of a rule
```

`lib/validation` shared with the server matters: the max-units rule must not be written twice
and drift. The client copy is for UX; **the server copy is authority**.

## 16.3 Role-adaptive UI

The student surface is not an admin form with fields disabled. Disabled inputs imply "you could
edit this if permitted" and invite tampering attempts. Protected data renders as **text with a
provenance note** — "Programme is set by the University. Contact the Registry to request a
correction." — which is both honest and support-deflecting.

Permission-aware rendering hides what a user cannot do, but **the server always re-checks**;
hidden UI is never a security control.

## 16.4 Design system

A small owned component library over a heavyweight kit — bundle size is a hard constraint (§16.1).

Accessibility is a functional requirement, not polish: WCAG 2.1 AA, full keyboard operation,
visible focus, semantic HTML, form errors tied to inputs via `aria-describedby`, ≥4.5:1 contrast.
Students with disabilities must be able to register for courses.

Domain-specific UI needs:
- **Status semantics never carried by colour alone** — pass/fail, cleared/blocked need icon + text
- **Dense data tables** that stay readable on a 360 px screen (results, registration)
- **Print stylesheets** — registration slips, exam cards, and result sheets are printed constantly
- **Progressive disclosure** for long multi-step flows (activation, registration, clearance)

## 16.5 State management

Server state via TanStack Query (caching, retry, background revalidation). Client state kept
minimal and local. **No global store** — most "global state" here is server state, and treating
it as client state is how stale CGPAs get displayed after a result amendment.

---

# §17 File / Document Storage Architecture

## 17.1 Classes

| Class | Examples | Store | Retention |
|---|---|---|---|
| **Student uploads** | Passport photo, credentials, medical reports | Object store, private | Per policy (`Q-29`) |
| **Generated documents** | Transcripts, statements, exam cards, slips | Object store, WORM | Permanent |
| **Import artefacts** | Uploaded CSVs, diff reports | Object store, immutable | Permanent (evidence) |
| **Audit anchors** | Hash-chain roots | Object-locked bucket | Permanent |
| **Biometric templates** | Fingerprint templates (`Q-20`) | Encrypted, segregated | Deletable on request |

## 17.2 Rules

- **Never store files in the database**; store references. Never serve from a public bucket.
- **All access via short-lived pre-signed URLs**, authorised per request — a leaked URL expires.
- **Upload pipeline:** type allowlist (magic-byte checked, not extension), size cap,
  virus scan, strip EXIF from images, re-encode images to a canonical form, generate a
  content hash, store under a random key (never a user-supplied filename).
- **Content-addressed storage** for generated documents: the hash *is* the identity, which is
  what makes §13.3 verification work.
- **Encryption at rest**, with biometrics under a separate key so crypto-erasure is possible
  without touching academic records (`R13`, §20).
- **Immutability/object-lock** for generated documents and audit anchors — a transcript that can
  be silently replaced is not evidence of anything.

## 17.3 Document generation

Rendered in workers, never inline in a request — a 500-student result-sheet PDF must not block
an API thread. Deterministic output (§13.2). Templates are versioned, and every generated
document records the template version used, so a document can always be explained years later.

---

# §18 Notification Architecture

## 18.1 Channels and reality

`Q-30` asks whether the institution can actually run transactional email/SMS at scale
(dedicated domain, SPF/DKIM/DMARC, shortcode). Many cannot at first.

**Therefore: in-app notifications are the reliable baseline and always written; email and SMS
are best-effort enhancements behind feature flags.** A workflow must never depend on an email
arriving — students routinely miss them, and university mail is frequently misconfigured.

| Channel | Use | Reliability |
|---|---|---|
| In-app | Everything | Guaranteed — stored in DB |
| Email | Activation, receipts, results, approvals | Best effort, retried |
| SMS | High-value only: activation, payment confirmation, adverse status | Costly, `Q-30` |
| Push | Deferred to Phase 4+ | — |

## 18.2 Design

```
DomainEvent → NotificationRule (template, channels, audience, throttle)
            → NotificationDispatch (one row per recipient per channel)
            → Provider adapter (retry w/ exponential backoff, DLQ)
```

- Templates are versioned and localised (`Q-31` for language requirements)
- **Every dispatch is recorded** — "the system never told me" is a common dispute, and delivery
  records settle it
- Deduplication and throttling: publishing 40,000 results must not send 40,000 SMS in one burst,
  nor trip provider rate limits
- User preferences respected, **except** for security-critical notices (activation, password
  change, protected-field amendment) which are always delivered on every available channel
- Notifications carry **no sensitive payload** — "Your result for CPE510 has been published"
  with a link, never the grade in the SMS body. Assume SMS and email are read by third parties.

## 18.3 Security notifications (mandatory)

Activation completed · password changed · MFA enrolled/removed · new-device login ·
**protected-field amendment** · payment confirmed · adverse status change.

The amendment notice is the important one: if an insider alters a student's record, the student
learns immediately. That is a detective control the audit log alone does not provide.

---

# §19 Audit-Log Architecture

## 19.1 Two tiers (calibrated, per `R13`)

`R13` cautions that cryptographic tamper-evidence is for a specific threat model, not a default.
Applying hash-chaining to every log line wastes throughput and obscures what matters.

| Tier | Scope | Mechanism |
|---|---|---|
| **Tier 1 — Standard** | All reads/writes of consequence, auth events, admin actions | Append-only table, DB-enforced |
| **Tier 2 — Tamper-evident** | Identity mutations, result lifecycle, finance movements, permission grants, Senate approvals | Tier 1 **+ hash chain + external anchoring** |

## 19.2 Append-only enforcement

`R13`: append-only by convention is not a security property — enforce at the database, not in code.

```sql
CREATE OR REPLACE FUNCTION audit_immutable()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only (attempted %)', TG_OP;
END $$;

CREATE TRIGGER trg_audit_no_update BEFORE UPDATE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();
CREATE TRIGGER trg_audit_no_delete BEFORE DELETE ON audit_event
  FOR EACH ROW EXECUTE FUNCTION audit_immutable();

REVOKE UPDATE, DELETE ON audit_event FROM eportal_app;  -- INSERT + SELECT only
```

`audit:write` is denied to **every** role including `SUPER_ADMIN` (§5.3) — rows are written by
the system, never by a user action.

## 19.3 Hash chain (Tier 2)

```
seq         bigint, monotonic
prev_hash   bytea
row_hash    = SHA256(prev_hash ‖ seq ‖ canonical_json(semantic_fields))
genesis     = fixed constant for seq 0
```

**Concurrency:** appends are serialised with a **PostgreSQL advisory lock** so two concurrent
inserts cannot chain off the same predecessor (`R13`). The lock is held only for the append,
and Tier-2 events are low-volume relative to traffic, so this is not a throughput concern.

**Verification** replays a segment, recomputing each row hash and checking each `prev_hash`
against its predecessor, reporting the first break and distinguishing sequence gaps, predecessor
mismatches, and row-hash mismatches.

## 19.4 Anchoring — the part most designs omit

`R13` is emphatic: a self-contained chain cannot detect a privileged rewrite of the entire table.
The root must be published where the log operator cannot reach it.

```
Hourly:  publish current head hash → object-locked (WORM) bucket, separate credentials
Daily:   publish head hash → third-party timestamping service and/or
                             a separate institutional system (e.g. Internal Audit)
Endpoint: GET /admin/audit/head  → current head for independent verification
```

Anchoring destinations must not be administrable by the same people who administer the database.
That separation is the whole point.

## 19.5 Event schema

```
occurred_at · actor_user_id · actor_roles · actor_scope · impersonated_by
action · entity_type · entity_id · before · after (redacted per policy)
correlation_id · request_id · ip · user_agent · outcome · reason
seq · prev_hash · row_hash          (Tier 2 only)
```

Answers the investigator's five questions: who, when, what, what it touched, how it connects (`R13`).

## 19.6 NDPA reconciliation

Erasure rights vs an immutable log (`R13`, `R15`) are reconciled by **crypto-erasure**: personal
fields in audit payloads are encrypted with per-subject keys; destroying the key renders the
plaintext unrecoverable while the hashed ciphertext bytes are unchanged, so the chain stays valid.
Non-identifying metadata is retained.

Academic records themselves are **not** subject to erasure — the university's statutory
record-keeping obligation is a competing lawful basis. This distinction should be confirmed with
the DPO (`Q-29`).

## 19.7 Meta-audit

Reads *of* the audit table are themselves logged, via `pgaudit`, to a separate append-only sink
(`R13`). Watching the watchers matters when the threat model includes privileged insiders.

---

# §20 Security Architecture

## 20.1 Threat model

| Threat | Impact | Primary controls |
|---|---|---|
| **Student forges/alters own record** | Fraudulent degree | §0 four-layer enforcement; separate DTOs; DB trigger; RLS |
| **Account takeover of a student** | Result/fee tampering attempts, PII theft | MFA, lockout, contact-on-file recovery (§6.5), device alerts |
| **Takeover of Registrar/HOD** | Mass record or result alteration | Mandatory MFA, dual control on all sensitive ops, hash-chained audit, break-glass alerting |
| **Malicious insider** | Silent record alteration | SOD, dual control, tamper-evident audit + external anchoring, student notification on amendment |
| **Enumeration of student body** | Mass PII exposure | Constant-time identical responses, strict rate limits, no data echo |
| **Payment fraud / replay** | Financial loss | Signature verification, idempotency, server-side verification, daily settlement reconciliation |
| **Result leakage pre-publication** | Integrity/fairness harm | Publication gate, scoped visibility, audit on every read of unpublished results |
| **Bulk data exfiltration** | Mass PII breach (NDPA) | Export permissions, rate/volume limits, watermarking, alerting on unusual volume |
| **Registration-day DoS** | Students miss registration | Edge rate limiting, waiting room, scheduled pre-scaling, graceful degradation |
| **Supply-chain compromise** | Full system | Lockfiles, SCA in CI, pinned base images, SBOM |

## 20.2 Defence in depth

```
Edge      WAF · TLS 1.3 · HSTS · rate limiting · bot mitigation
App       AuthN → AuthZ (permission + scope) → input validation → business rules
Data      Least-privilege DB roles · RLS · triggers · column encryption
Audit     Append-only, hash-chained, externally anchored
Detect    Anomaly alerts, meta-audit, security notifications to data subjects
```

## 20.3 Application security baseline

- **OWASP Top 10** covered explicitly; parameterised queries only (ORM or prepared statements)
- **Input validation server-side always** — client validation is UX only
- **Output encoding** + strict CSP (no `unsafe-inline`); XSS in a portal that renders
  staff-entered course titles is a live risk
- **CSRF**: `SameSite=Strict` cookies + tokens on state-changing forms
- **SSRF**: outbound allowlist for webhooks and integrations
- **Secrets** in a manager, never in the repo; rotation procedure documented
- **Dependencies**: lockfiles committed, automated vulnerability scanning, patch SLA
- **Errors**: no stack traces or internal identifiers to clients

## 20.4 NDPA 2023 compliance (`R15`)

Legally binding, not optional. Any university portal exceeds the 200-data-subject threshold
immediately, making it a **controller of major importance**.

| Obligation | Implementation |
|---|---|
| NDPC registration | Institutional action — **flag to management** (`Q-29`) |
| **DPO appointed** | Institutional; system provides DSAR tooling and a compliance dashboard |
| Lawful basis | Documented per processing activity; consent explicit and revocable where used |
| DPIA | Required before go-live — biometrics and large-scale processing make this non-optional |
| **Breach notice ≤ 72 h** | Detection alerting, documented IR runbook, **breach register** in-system |
| Security measures | Encryption, backups, resilience, testing (§21–§23) |
| Processor contracts | Written agreements with gateway/SMS/hosting vendors; sub-processor register |
| **Cross-border transfers** | **Constrains hosting** — offshore cloud requires a documented legal basis. Nigeria-resident hosting is the simplest compliant path (`Q-33`) |
| Data-subject rights | Access, rectification (via §7.6 amendment), objection, portability |
| Sensitive data | Biometrics and health data (medical exemptions, `R4`) segregated, separately keyed, strictly access-controlled |

**Penalties:** up to ₦10 m or 2% of annual gross revenue for controllers of major importance,
plus potential imprisonment for non-compliance with NDPC orders (`R15`).

## 20.5 Biometric-specific controls (`Q-20`)

If in scope: store **templates, never raw images**; separate encryption key; explicit consent
with a non-biometric alternative always available; **mandatory manual fallback** given the
89–95% accuracy reported in Nigerian deployments (`R14`); deletable on request via crypto-erasure.

## 20.6 Operational security

Structured security logging; alerting on privilege changes, bulk exports, failed-auth spikes,
audit-chain breaks, and CGPA-divergence (§10.5). Documented incident response with severity
tiers and the 72-hour NDPA clock built into the runbook. Independent penetration test before
go-live, focused on the activation ceremony and the authorisation matrix.

---

# §21 Testing Strategy

## 21.1 Risk-weighted, not coverage-weighted

A blanket "80% coverage" target spreads effort evenly across code of wildly unequal consequence.
Effort is allocated by blast radius instead.

| Tier | Area | Requirement |
|---|---|---|
| **Critical** | Identity invariant, RBAC matrix, GPA/CGPA, payments, activation, graduation eligibility | **Exhaustive**, including adversarial and property-based tests. Coverage ≥ 95% |
| **High** | Registration rules, approval pipelines, clearance, document generation | Thorough unit + integration. ≥ 85% |
| **Standard** | CRUD, reporting, notifications | Happy path + key errors. ≥ 70% |
| **Low** | Static pages, styling | Smoke only |

## 21.2 The invariant test suite (§0)

A dedicated, permanently-red-if-broken suite. **If any of these ever passes when it should fail,
the system is unsafe to operate.**

```
✗ Student principal cannot PATCH any protected field — every field, every endpoint, every verb
✗ No student-signup endpoint exists (route table asserted, not just tested)
✗ Direct SQL UPDATE of a protected column raises the DB exception
✗ A student cannot activate a record they cannot verify
✗ A record cannot be activated twice (concurrent attempts → exactly one winner)
✗ A student cannot register outside the window / while unfee-cleared / while withdrawn
✗ A lecturer cannot score an offering they are not allocated
✗ A lecturer cannot approve their own submission (SOD)
✗ An approver cannot approve two consecutive stages
✗ A published result cannot be updated in place
✗ CGPA cannot be written directly by any principal
✗ A candidate with outstanding requirements cannot reach SENATE_APPROVED
✗ audit_event rejects UPDATE and DELETE from every role
✗ A tampered audit row is detected by chain verification
```

Written as **negative tests asserting denial**, and re-run against every endpoint automatically —
a new endpoint that forgets authorisation fails the suite by construction.

## 21.3 Test types

- **Unit** — pure domain logic. GPA computation, grade mapping, progression rules, fee
  calculation, prerequisite resolution. Fast, no I/O.
- **Property-based** (fast-check) — for computation. E.g. *CGPA always lies within
  [min grade point, max grade point]*; *recomputation is idempotent*; *ledger balance equals
  Σcredits − Σdebits for any operation sequence*. Property tests find the edge cases example
  tests miss, and this domain is full of them.
- **Integration** — real PostgreSQL in a container (never a mock/SQLite; RLS and triggers must
  be exercised). Per-test transactional rollback.
- **Contract** — payment providers stubbed against recorded real payloads, including the
  underpayment, overpayment, duplicate-webhook, and abandoned-RRR cases (`R8`).
- **E2E** (Playwright) — the flows that must never break: activation, registration, score entry
  → approval → publication, payment, clearance → graduation.
- **Load** (k6) — registration spike specifically. Model the real shape: near-zero baseline then
  50× (`R12`). Assert correctness under load — **no double registration, no seat oversell** —
  not merely response time.
- **Security** — SAST, dependency scanning, secret scanning in CI; automated ZAP baseline;
  manual pentest pre-launch.
- **Accessibility** — axe in CI on key pages; manual keyboard and screen-reader passes.
- **Migration** — every migration tested forward and backward against a production-shaped dataset.

## 21.4 Test data

Realistic, synthetic, **never production data in lower environments**. Deterministic seeds
covering: fresh 100L student, carryover-carrying student, spill-over final-year, probation,
withdrawn, graduated alumnus, part-time/JUPEB (`Q-36`), loan-funded (`Q-39`), and a student with
an amended name post-transcript-issue.

Those last few exist because they are the cases that break naive implementations.

## 21.5 CI gates

Lint → typecheck → **module-boundary check (§4.1)** → unit → integration → invariant suite →
build → E2E (critical paths) → security scan → performance budget (§16.1).
**Invariant-suite failure blocks merge unconditionally** — it is not overridable.

---

# §22 DevOps / Deployment Architecture

## 22.1 Environments and promotion

```
local → CI → staging (production-shaped, anonymised) → production
                                                    ↘ drill (restore rehearsals, §23)
```

Every environment is provisioned from the same IaC; only configuration differs. Configuration is
environment variables validated at boot — the app **refuses to start** on missing or malformed
config rather than failing at 2 a.m. on the first request that touches it.

## 22.2 Deployment topology

Sized to `Q-33`. For the assumed ~30k students:

| Component | Baseline | Registration peak |
|---|---|---|
| App nodes | 2–3 | 6–10 (**scheduled**, not reactive) |
| PostgreSQL | 1 primary + 1 replica | + read replica(s) |
| Redis | 1 with persistence | same |
| Workers | 2 | 4–6 |
| Object store | S3-compatible | same |

**Kubernetes is not recommended at this scale.** Docker Compose on a small number of well-managed
hosts, or a managed container service, delivers this topology with far less operational surface.
Adopt k8s only if `Q-33` reveals genuinely larger scale or an existing platform team.

**Hosting is constrained by NDPA cross-border rules** (`R15`, §20.4) — Nigeria-resident hosting is
the simplest compliant path; offshore requires a documented transfer basis. This is a legal
constraint on an apparently technical decision, and it is easy to miss.

## 22.3 Registration-day playbook (`R12`)

Registration is a scheduled, known-in-advance event. Treat it as a launch, not as traffic.

```
T-7d   Load test against staging with production-shaped data
T-2d   Verify backups + rehearse restore; freeze non-essential deploys
T-1d   Pre-scale app nodes and workers; warm caches; verify waiting-room config
T-1h   Confirm scaling active; on-call staffed; dashboards up
T-0    Open window (staggered by level/department if configured)
T+     Watch: error rate, p95 latency, DB connections, queue depth, seat-claim conflicts
T+1d   Scale down; post-event review
```

Explicitly: **do not rely on reactive autoscaling** — metric interval + boot + bootstrap +
health-check latency means it arrives after the students have already failed to register (`R12`).

## 22.4 CI/CD

Trunk-based with short-lived branches; every PR runs the §21.5 gates. Deploys are automated,
versioned, and reversible. **Migrations are expand-contract** (add nullable → backfill → switch
reads → drop old) so a deploy is always rollback-safe; a migration that drops a column in the
same release as the code change makes rollback impossible.

Feature flags for risky rollouts. Zero-downtime deploys with health checks and drain.

## 22.5 Observability

- **Metrics** (Prometheus/Grafana): request rate/latency/errors per endpoint class, DB pool
  saturation, queue depth and age, payment success rate, notification delivery rate
- **Domain dashboards** that ops actually needs: registrations/minute, results pending approval
  by stage, payments pending reconciliation, activation success rate
- **Tracing** (OpenTelemetry) with correlation ids shared with audit
- **Logs**: structured JSON, no PII in log bodies, correlation-id joined
- **Alerts** on symptoms users feel (error rate, latency, failed logins, stuck queue) plus
  integrity alarms: **audit chain break**, **CGPA divergence**, unreconciled payments > threshold

## 22.6 Operational runbooks

Written before go-live, not after the first incident: restore from backup, failed payment
reconciliation, stuck approval batch, mass activation failure, registration overload,
suspected data breach (with the 72-hour NDPA clock, `R15`), and the break-glass procedure.

---

# §23 Backup / Disaster-Recovery Strategy

## 23.1 Objectives

| Data | RPO | RTO | Justification |
|---|---|---|---|
| Academic records | **≤ 5 min** | ≤ 4 h | Irreplaceable; a lost result cannot be reconstructed |
| Financial records | **≤ 5 min** | ≤ 4 h | Legally and financially material |
| Audit log | **0 (no loss)** | ≤ 4 h | Evidentiary value is destroyed by any gap |
| Documents/uploads | ≤ 1 h | ≤ 8 h | Regenerable in part |
| Cache/session | N/A | minutes | Rebuildable; users re-login |

Confirm against institutional tolerance (`Q-33`).

## 23.2 Layers

```
1. Continuous archiving  WAL shipping → PITR to any second within retention
2. Nightly full backup   Encrypted, checksummed, retention 30d/12m/7y tiers
3. Weekly off-site copy  Different physical location / provider
4. WORM archive          Generated documents + audit anchors, object-locked (§17, §19.4)
5. Logical exports       Periodic schema+data dumps, guards against subtle corruption
                         that a physical backup would faithfully replicate
```

Layer 5 exists because physical backups replicate corruption perfectly. A logical export in a
portable format is the escape hatch when the problem is *in the data*.

## 23.3 The non-negotiable rule

> **An untested backup is not a backup.**

- **Monthly automated restore drill** into the `drill` environment, with verification queries:
  row counts, CGPA recomputation across a sample, audit-chain verification end to end
- **Quarterly full DR exercise** — simulate primary loss, restore, measure actual RTO against
  target, and document the gap honestly
- Drill results are recorded; a failed drill is a P1

Restoring into staging does not count — staging's configuration differs from production's, so
the drill would not exercise the real failure path.

## 23.4 Failure scenarios

| Scenario | Response |
|---|---|
| Primary DB loss | Promote replica; repoint app; verify audit chain integrity |
| Data corruption | PITR to just before the corrupting transaction (identified via audit) |
| Accidental mass deletion | PITR + audit reconstruction of the intervening window |
| **Ransomware** | Restore from immutable off-site copy; WORM archives are unencryptable by the attacker |
| Region/site loss | Restore off-site; accept the higher RTO; communicate to students |
| Malicious insider tampering | Chain verification identifies scope; anchors bound the blast radius (§19.4) |
| Payment provider outage | Queue intents; reconcile on recovery; extend the registration window |

## 23.5 Retention

Academic records: **permanent** (a transcript may be requested 40 years later — this drives §13.4
key-versioning). Financial: per statutory requirement. Audit: permanent for Tier 2. Personal data
beyond academic records: per NDPA policy and the DPO's determination (`Q-29`).

## 23.6 Business continuity

Degraded-mode operation is planned, not improvised: read-only mode (results and documents remain
viewable while writes are suspended), manual fallback procedures for exam-hall verification
(`R14`), and a documented communication plan for students during an outage. During registration
week, an outage without a communication plan produces a campus-wide crisis independent of the
technical fault.

---

*End of Part 3. Roadmap and risk register follow in `05-ROADMAP.md` (§24).*
