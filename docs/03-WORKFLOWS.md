# ePortal Blueprint — Part 2: Academic Workflows (§8–§14)

> Continues `02-ARCHITECTURE.md`. `Q-nn` flags resolve in `01-OPEN-QUESTIONS.md`;
> `Rn` evidence references resolve in `00-SPEC-PROVENANCE.md`.

---

# §8 Academic Workflow Architecture

## 8.1 The academic calendar is the system clock

Nearly every rule in this system is time-conditional: registration is open or closed, results
are released or embargoed, fees are due or overdue. Scattering date checks across modules
produces inconsistency and is unmaintainable.

**Decision:** one `organisation` module owns the calendar and exposes a single predicate:

```
isWindowOpen(windowType, scope, at = now) → boolean
```

Windows: `REGISTRATION` · `ADD_DROP` · `LATE_REGISTRATION` · `SCORE_ENTRY` · `RESULT_RELEASE`
· `EXAM` · `CLEARANCE` · `TRANSCRIPT_REQUEST`.

Windows are scoped (global / faculty / department / programme), because faculties routinely run
different calendars. Configuration is Registrar-only and audited; result-release dates require
dual approval (`Q-35`).

**Explicitly rejected:** letting each module store its own dates. That is how a portal ends up
accepting registrations after the exam timetable is published.

## 8.2 Session lifecycle

```
PLANNED ──▶ ACTIVE ──▶ TEACHING_COMPLETE ──▶ RESULTS_PROCESSING ──▶ CLOSED ──▶ ARCHIVED
```

- Exactly **one** `ACTIVE` session at a time (DB partial unique index), but a closed session
  may still be `RESULTS_PROCESSING` — these overlap in reality and the model must allow it.
- `CLOSED` freezes registration and score entry. Amendments then require the §10.6 path.
- `ARCHIVED` marks the session read-only forever; it becomes transcript source data.

## 8.3 Level progression

Runs at session end, **as a proposal engine, never a silent writer**.

```
For each ACTIVE student:
  1. Compute session GPA and CGPA from published grade records
  2. Evaluate ProgressionRule set for (programme, curriculum_version, level)
  3. Emit a PROPOSAL: PROMOTE | REPEAT | PROBATION | WITHDRAW | SPILL_OVER | GRADUATE_PENDING
  4. Queue for departmental/faculty review
  5. On approval → status-machine transition (§7.5) + level history row
  6. Notify student with the reason and the rule applied
```

Two deliberate design choices:

**Proposals, not automatic writes.** An automated withdrawal that turns out to be based on a
mis-entered score is catastrophic and hard to unwind. A human ratifies every adverse outcome.

**Rules live in data, not code.** `ProgressionRule` is a table — thresholds, carryover caps,
probation limits are institution-specific (`Q-04`, `Q-05`) and vary by programme. Sources show
real divergence: probation at CGPA < 1.00 (UNN) vs < 1.50; withdrawal after 5–6 carryovers;
never more than two probation periods in a career (`R5`).

> **Not invented here:** the actual thresholds. Ship with the rule engine and a config screen;
> populate from the institution's academic regulations before go-live.

## 8.4 Maximum duration enforcement

NUC allows standard duration + 50% — a 4-year programme permits 6 years (`R1`, `R5`). The system
computes `expected_graduation_session` at admission and raises escalating warnings as a student
approaches the limit, with a hard block plus Senate-extension pathway at the boundary.
Concrete durations per programme are `Q-03`/`Q-41` territory.

## 8.5 Curriculum versioning (INV-7)

A student is assessed against the curriculum of their **admission cohort**, not the current one.
`curriculum_version_id` is pinned at record creation and is a protected field. When a department
revises its curriculum, existing students are unaffected unless the Registrar runs an explicit,
audited migration with per-student mapping of old requirements to new.

Without this, a curriculum edit silently changes who is eligible to graduate — a failure mode
that surfaces only at final-year audit, when it is far too late.

---

# §9 Course-Registration Workflow

The highest-traffic and most concurrency-sensitive flow in the system (`R12`).

## 9.1 Eligibility gates

Evaluated in order; **all** must pass. Each returns a specific, actionable reason on failure —
"You are not eligible" is a support-ticket generator.

```
GATE 1  Account activated, STUDENT role, status ∈ {ACTIVE, PROBATION}
GATE 2  Registration window open for this scope                    (§8.1)
GATE 3  Fee clearance for this session                             (§11.4, Q-17, Q-39)
GATE 4  No blocking hold (disciplinary, outstanding clearance)
GATE 5  Not exceeded maximum programme duration                    (§8.4)
```

**Gate 3 is a query into `finance`, not a boolean flag.** Clearance = ledger balance satisfied
**OR** approved waiver **OR** approved NELFUND loan clearance (`Q-39`). The naive
`fees_paid = true` column breaks the moment a student is loan-funded, and `R16` shows loan
funding is now mainstream.

## 9.2 Course-list construction

```
Available = curriculum requirements for (curriculum_version, level, semester)
          + CARRYOVERS  (failed, not yet passed — highest priority, auto-included)
          + eligible electives per curriculum rules            (Q-10)
          − courses already passed (unless repeat-for-upgrade is permitted, Q-02)
          − courses whose prerequisites are unsatisfied        (Q-11)
```

Carryovers are **pre-selected and non-removable by default** (`R5`: they must be retaken at the
next available opportunity). A student may not quietly skip a carryover to keep their unit load
comfortable; removal requires course-adviser approval.

Prerequisite failure is configurable as hard-block or warn-with-override (`Q-11`) — sources show
both models in use, and override channels genuinely exist for exceptional cases.

## 9.3 Validation at submission

| Check | Rule | Configurable |
|---|---|---|
| Minimum units | ≥ institutional minimum | `Q-03` (NUC floor 15; 18 observed) |
| Maximum units | ≤ institutional maximum | `Q-03` (24 typical, incl. retakes per `R5`) |
| Timetable clash | No two offerings in the same slot | Warn or block — `Q-13` |
| Duplicate | Not already registered this session | Hard, DB constraint |
| Elective pairing | One of a paired set | `Q-10` |
| Level appropriateness | Within permitted level spread | `Q-11` |
| Capacity | Seats available | Only if capacity is enforced — `Q-13` |

## 9.4 Concurrency: the seat-claim problem

`R12` is explicit that horizontal scaling does not fix the seat race — in-process locks and
singletons break across nodes.

**Chosen approach — atomic conditional update, no distributed lock:**

```sql
UPDATE course_offering
   SET seats_taken = seats_taken + 1
 WHERE id = $1
   AND (capacity IS NULL OR seats_taken < capacity)
RETURNING seats_taken;
-- zero rows returned ⇒ full; fail this line cleanly with a precise message
```

Rationale: a single-statement conditional update is atomic under PostgreSQL's row locking, needs
no external coordinator, and is correct across any number of app nodes. A Redis distributed lock
would add a failure mode (lock server down ⇒ registration down) for no correctness gain.

The whole registration commit runs in one transaction at `READ COMMITTED`, claiming seats in a
**deterministic order (offering id ascending)** to avoid deadlocks between concurrent submissions.

Where capacity is not enforced (common — many Nigerian universities do not cap core courses),
this collapses to a plain insert and the contention disappears.

## 9.5 Load strategy for registration day

Directly from `R12` — the failure mode is a 50× spike against average-sized infrastructure:

| Control | Detail |
|---|---|
| **Scheduled pre-scaling** | Scale up 60 min before the window opens. Registration dates are known months ahead; reactive autoscaling is too slow (metric interval + boot + bootstrap + health check) |
| **Staggered windows** | Open by level or department in waves — the cheapest and most effective control |
| **Virtual waiting room** | Admission control at the edge during peaks. KCL reported an 80% support-request reduction; Swinburne protects 25k+ students |
| **Cached read path** | Course catalogue served from Redis/replicas; only the commit touches the primary |
| **Graceful degradation** | Under load, shed degree-audit previews, analytics, and schedule visualisation. **Never** shed the commit path |
| **Backpressure** | Bounded queues with fast rejection and a clear retry message — not unbounded queueing that spirals latency |
| **Idempotency** | Submissions carry an idempotency key; a double-tap on a slow connection cannot double-register |

That last point is not a nicety. On the connectivity these portals actually run over, users
double-submit constantly.

## 9.6 Approval and locking

```
DRAFT ──submit──▶ PENDING_ADVISER ──▶ PENDING_HOD ──▶ APPROVED ──lock──▶ LOCKED
   ▲                    │                  │
   └────reject──────────┴──────────────────┘   (with comments, back to student)
```

- The chain is **configurable** (`Q-12`) — some institutions use adviser-only, some add HOD.
- `LOCKED` snapshots credit units onto each line (INV-6) and creates exam eligibility (INV-10).
- Post-lock changes go through formal add/drop within the add/drop window, with approval, and
  every version of the registration is retained.
- A **printable, signed registration slip** is generated at lock — institutions still require
  paper, and this is what the student presents at the exam hall.

## 9.7 Late registration

`R4` documents a real exception: a student who misses the window may submit a medical report to
the Dean within four weeks, validated by the Director of Medical & Health Services, exempting
them from late-registration penalties.

Modelled as `RegistrationException` — request, evidence upload, health-officer validation, Dean
approval, then a scoped window reopened for that one student, fully audited. The penalty
schedule and who validates are `Q-13`/`Q-15`.

---

# §10 Result-Management Workflow

The most integrity-critical flow. A wrong result changes a life outcome.

## 10.1 Assessment structure (set by HOD, not lecturer)

From `R11` (Busitema): components and weightings are fixed by the HOD when allocating the course
— e.g. coursework 30% / exam 70%. The lecturer enters scores but **cannot change the weighting**.

This is a genuine integrity control, adopted as INV-11:

```
CourseOffering
   └── AssessmentComponent[]   (name, max_score, weight_percent)   ← HOD-owned
          └── ScoreEntry[]     (per registered student)            ← Lecturer-owned
```

Weights must sum to 100 (DB check). Changing a weighting after any score exists requires HOD
action plus a recomputation of every affected total, fully audited.

## 10.2 Score entry

- Lecturer sees **only** their allocated offerings, **only** students with a `LOCKED`
  registration line (INV-10 in the other direction — an unregistered student cannot be scored).
- Entry via UI grid or CSV upload with a dry-run diff, same discipline as §7.3.
- Validation: within `0..max_score`, numeric, no blanks unless explicitly marked
  `ABSENT` / `WITHHELD` / `MEDICAL`.
- Out-of-range values are **hard-rejected**, not clamped (`Q-16`).
- Autosave drafts; explicit "Submit for approval" transition. Draft ≠ submitted.
- Score-entry window enforced (§8.1).

## 10.3 Grade computation

```
total_score  = Σ (component_score / component_max × component_weight)
letter_grade = lookup(total_score, GradeScale[institution])      ← Q-01
grade_point  = GradeScale.grade_point
```

`GradeScale` is a **table, not a constant**. Ships with the NUC 5-point default (A=70–100 → 5,
B=60–69 → 4, C=50–59 → 3, D=45–49 → 2, E=40–44 → 1, F<40 → 0) clearly marked provisional,
because `R1` records that some institutions and STEM programmes set A at 75% (`Q-01`).

Scales are versioned by session, so historical results recompute against the scale in force
when they were earned — not the current one.

## 10.4 Approval pipeline

`R11` found **no** surveyed system implementing a full Lecturer → HOD → Dean → Senate chain;
Kwara Polytechnic stops at Academic Board with no Dean tier. The conclusion adopted is a
configurable N-stage pipeline rather than any hard-coded chain (`Q-14`).

```
   DRAFT
     │ lecturer submits
     ▼
   PENDING_STAGE_1 ──reject(comment)──▶ back to lecturer
     │ approve
     ▼
   PENDING_STAGE_n  … configurable stages, each with a role + scope
     │
     ▼
   SENATE_RATIFIED
     │ publish (dual control)
     ▼
   PUBLISHED   ← immutable from here (INV-12)
```

Properties:
- Each stage records approver, timestamp, comment. **No stage may be skipped**; no actor may
  approve two consecutive stages (SOD, §5.4).
- Rejection routes back to the originator with a mandatory comment — never a silent bounce.
- Approvers get a daily digest of outstanding items and see only what needs their attention
  (pattern from Purdue's registration workflow, `R11`).
- Publication is dual-control and is what makes results student-visible.

## 10.5 GPA/CGPA computation

```
GPA(semester)  = Σ(grade_point × units) / Σ(units)          over that semester
CGPA           = Σ(grade_point × units) / Σ(units)          over all counted attempts
```

`Q-02` — dilution vs best-grade — is **the** blocking policy question here, and the two models
give materially different CGPAs for the same student. It is expressed entirely through
`grade_record.counts_toward_cgpa` (§3.2):

- **Dilution:** every attempt counts. All rows `true`.
- **Best-grade:** only the highest attempt counts; failures remain visible on the transcript
  but are excluded from the denominator. Only the best row is `true`.

Both are implemented; the institution picks one, university-wide or per-programme.
**No default is chosen** — picking wrong silently misclassifies degrees.

Integrity mechanics:
- CGPA is **derived** (Class D, §7.1). Stored snapshots are a cache.
- A nightly job recomputes every active student's CGPA from `grade_record` and **alerts on any
  divergence** from the stored snapshot. Divergence is a P1 incident.
- Recomputation is deterministic and pure — same inputs, same output, always.
- Every published transcript records the CGPA **and** the scale/policy version used.

## 10.6 Amendment after publication (INV-12)

Published results are never updated in place.

```
1. REQUEST    Amendment raised with reason + evidence (script remark, entry error, malpractice)
2. APPROVE    Dual control; institution-specific signatories (Q-15)
3. SUPERSEDE  New grade_record version created; old row keeps version, gets superseded_by
4. RECOMPUTE  GPA/CGPA recalculated; progression re-evaluated; graduation re-evaluated
5. CASCADE    Flag every already-issued transcript/statement bearing the old value
6. NOTIFY     Student informed of the change and the reason
```

Step 5 again: a result amendment after a transcript is in circulation creates a document
mismatch in the outside world. The system must surface it (same class as INV-18).

## 10.7 Withheld results

Real institutions withhold results for outstanding fees, disciplinary cases, or pending
malpractice adjudication. Modelled explicitly as a `ResultWithholding` with reason, authority,
and release condition — never by deleting or hiding the underlying record. The student sees
"withheld" and the reason, not a blank.

---

# §11 Finance / Payment Architecture

## 11.1 Ledger-first design

**Decision: an append-only ledger; balances are always derived (INV-14).**

A mutable `balance` column is the classic source of silent financial corruption — a failed
partial update leaves a wrong number with no way to detect it. Instead:

```
LedgerEntry(student, direction DEBIT|CREDIT, amount, source, source_id, idempotency_key)

balance(student, session) = Σ credits − Σ debits
```

Every entry is immutable and carries an idempotency key. Reversals are new compensating entries,
never deletions. Balance queries are served from a materialised view refreshed on write, with
the ledger remaining the source of truth.

## 11.2 Billing model

```
FeeSchedule (programme × level × session × student category)
   └── FeeItem[]  (tuition, faculty due, dept due, ICT levy, hostel, …)
          ↓ generate
      Invoice ── InvoiceLine[]
          ↓
      PaymentIntent[]   (supports instalments, Q-17)
```

Fee structure is heavily institution-specific (`Q-17`): flat vs itemised, instalments, late fees,
differential fees for the many student categories `R16` revealed (UTME / DE / JUPEB / part-time /
postgraduate / international — `Q-36`).

Separately, `R16` shows **miscellaneous payments** (certificate fees, verification fees) are a
distinct revenue stream, so the model must support arbitrary payable items unattached to a
session fee schedule.

## 11.3 Payment gateway integration

`R8`: Remita/RRR dominates federal and tertiary collections; Paystack/Flutterwave/Monnify offer
better checkout UX; Monnify-style dedicated virtual accounts materially simplify reconciliation.

**Design: a provider-agnostic `PaymentProvider` interface** with concrete adapters. Which
provider(s) are actually mandated is `Q-18`.

```
interface PaymentProvider {
  createIntent(invoice, amount) → { providerReference, redirectUrl?, rrr? }
  verify(providerReference)     → { status, amountReceived, paidAt, raw }
  parseWebhook(payload, sig)    → NormalisedEvent
}
```

### Non-negotiable rules

1. **Never trust the client callback.** A browser redirect to `/payment/success` proves nothing.
   Confirmation comes only from a signed webhook or a server-side verification call.
2. **Verify webhook signatures**, reject on mismatch, and log the rejection.
3. **Idempotency everywhere** — providers retry; duplicate webhook deliveries are normal. Keyed
   on provider reference + event id.
4. **Reconciliation regardless of webhooks.** `R8` notes RRRs sit "Pending" indefinitely, and on
   real Nigerian network conditions webhooks get dropped. A scheduled job polls every
   non-terminal intent with backoff. **Webhooks are an optimisation; polling is the guarantee.**
5. **Handle amount mismatch as first-class states.** `R8` confirms exact-amount entry matters and
   mismatches stall transactions — hence `UNDER` and `OVER` in `PaymentIntent.status` (§3.3), each
   with a defined resolution path (top-up / credit-forward / refund per `Q-17`), never a silent failure.
6. **Store the raw provider payload** immutably for dispute resolution.
7. **Reconcile against provider settlement reports** daily, not just per-transaction — this is
   what catches money received but never posted.

### Payment state machine

```
CREATED ──▶ PENDING ──┬──▶ PAID       ──▶ POSTED_TO_LEDGER
                      ├──▶ UNDERPAID  ──▶ awaiting top-up
                      ├──▶ OVERPAID   ──▶ credit / refund decision
                      ├──▶ FAILED     ──▶ retryable
                      └──▶ ABANDONED  ──▶ swept after TTL (unpaid RRR)
```

## 11.4 Fee clearance (INV-16)

```
isFeeCleared(student, session) =
      ledgerBalance(student, session) ≥ threshold(session)     // Q-17: full or part payment?
   OR hasApprovedWaiver(student, session)
   OR hasApprovedLoanClearance(student, session)               // NELFUND, Q-39
```

A **derived predicate**, never a stored boolean. `Q-39` is a genuine open risk: if a student
registers and sits exams on the strength of a loan that never disburses, who bears it? That is
an institutional policy decision, not an engineering one.

## 11.5 Financial controls

- Waivers and reversals require dual approval (§5.4) and full audit
- Every finance mutation emits a hash-chained audit event (§19)
- Bursar dashboards reconcile expected vs received vs settled
- **No refund is ever automatic** — always a reviewed, approved, audited operation
- Amounts are integer minor units (kobo), never floats

---

# §12 Examination Architecture

## 12.1 Exam eligibility (the `R4` rule)

> "Any student who fails to register for a course will not be allowed to sit examinations in it."

This is INV-10, enforced structurally: eligibility rows are generated **from locked registration
lines**, so an unregistered student has no eligibility record to produce.

```
eligible(student, offering) =
      LOCKED registration line exists for that offering
  AND isFeeCleared(student, session)                       // Q-17
  AND attendance ≥ minimum, if tracked                     // Q-23
  AND no active withholding / disciplinary bar
```

Attendance requirement is `Q-23` — commonly cited as 75%, but whether it is tracked in this
system or by departments on paper is institution-specific. Modelled as optional and off by
default rather than assumed.

## 12.2 Exam card

Generated per student per exam period once eligible: photo, matric number, programme, level,
the exact list of eligible courses, venue/seat where allocated, and a QR code resolving to a
live eligibility check.

`R14` is directly relevant: token-based admission (ID cards, fee clearance cards) is recognised
as weak — losable, stealable, forgeable. The QR code makes the card verifiable against live
state rather than trusted as a printed artefact. Cards are regenerated (not edited) if
eligibility changes, and every issuance is audited.

## 12.3 Timetabling

Scheduling is a constraint-satisfaction problem. **Deliberate scope decision: v1 provides
assisted manual timetabling with conflict detection, not an automatic solver.**

Constraints checked: no student double-booked (computed from actual registrations), venue
capacity, invigilator availability, no back-to-back hardship where the institution forbids it.

An automatic solver is a research project in its own right; conflict *detection* delivers most
of the value at a fraction of the cost. Flagged as a Phase 2+ enhancement.

## 12.4 Attendance and biometrics

`R14` reports Nigerian deployments at 89.33% first-attempt accuracy (Covenant/OBCAMS) and 95.3%
verification accuracy with <10% false positives in a 630-student study.

**Therefore: biometric verification is an optional accelerator with a mandatory manual fallback.**
A 5–10% failure rate against a 500-student hall means hundreds of students blocked from an exam
they are entitled to sit. Any design that treats biometrics as authoritative is unsafe.

Biometric templates are sensitive personal data under NDPA (`R15`) — see §20 for storage
requirements (`Q-20`).

## 12.5 Misconduct

If in scope (`Q-24`): case creation by an invigilator, evidence attachment, panel adjudication,
outcome recording, and — critically — any resulting grade change flows through the §10.6
amendment path. The examination module **never** writes results directly (§4.2).

---

# §13 Transcript / Certificate Architecture

## 13.1 Document types

`R7` distinguishes these sharply, and conflating them causes real harm:

| Document | When | Accepted for |
|---|---|---|
| **Statement of Result** | After Senate approval, before convocation | NYSC, immediate employment. The practical "golden ticket" (`R6`) |
| **Provisional Transcript** | Coursework complete, degree not yet conferred | NYSC call-up processing |
| **Final Transcript** | Post-convocation | Everything; carries the degree class |
| **Senate-authenticated transcript** | On request | The **only** version accepted for NYSC, foreign study, professional registration, regulated employment |
| **Directorate transcript** | Internal | Administrative use only — **not** accepted for formal verification |
| **Certificate** | At convocation | The degree certificate itself |

## 13.2 Generation pipeline

```
1. REQUEST     Student/alumnus requests; type, copies, destination
2. FEE         Invoice raised, payment confirmed (§11)              Q-25
3. ELIGIBILITY Clearance state, no holds, records complete
4. COMPILE     Pull published, non-superseded grade records for the whole academic history
5. REVIEW      Academic Office verifies against the master record
6. AUTHENTICATE Registrar/Senate authority applied; digital signature
7. RENDER      Deterministic PDF in a worker
8. DELIVER     Secure download link, and/or print + dispatch, tracked
9. RECORD      Immutable issuance record: who, when, what version, to whom
```

**Determinism requirement:** the same request against the same data must produce a
byte-identical PDF. This makes the document hashable, and the hash is what verification checks.
Non-determinism (embedded timestamps, unordered map iteration, font subsetting variance) breaks
verification silently — a real and easily-missed engineering trap.

## 13.3 Verification

`R9`'s consensus is clear: production systems put **issuer keys and hashes** on-chain, never
personal data, and most commercial platforms use a URL-based verification page.

**Decision: cryptographically signed PDF + a public verification endpoint. No blockchain.**

```
Document → SHA-256 hash → signed with the institution's private key
        → QR code encodes  https://portal.university.edu.ng/verify/{code}

Verifier scans → sees issue date, student name, programme, class of degree,
                 document type, validity status — NOT the full transcript
```

Rationale:
- A blockchain adds operational burden and a permanent dependency while solving a problem the
  institution's own signing key already solves. The verifier's trust anchor is *the university*,
  which is exactly who a public verification endpoint authenticates.
- `R9`'s cautionary note about AWS shutting down QLDB in July 2025 (`R13`) reinforces avoiding
  managed-ledger dependencies for a system with a multi-decade record-retention horizon.
- **Selective disclosure by default:** verification confirms the credential without exposing
  grades or enrolment history — a privacy property `R9` highlights and NDPA (`R15`) favours.
- **Revocation** is handled by the endpoint returning current status — a property paper documents
  and naive QR schemes both lack.

Verification codes are high-entropy, rate-limited, and enumeration-resistant.

## 13.4 Long-term integrity

Academic records outlive the software. Therefore:
- Every issued document's hash and metadata are retained permanently
- Signing keys are versioned and rotated; **old public keys stay published forever** so
  decades-old documents remain verifiable
- The QR encodes the key version used
- Documents are archived in WORM storage (§17, §23)

## 13.5 Convocation and certificates

Certificate issuance is a separate, tightly-controlled flow (serial number, collection record,
replacement-on-loss with affidavit). Whether certificate printing is in scope or handled by a
records office on security paper is `Q-26`/`Q-31`.

---

# §14 Clearance / Graduation Architecture

## 14.1 Clearance model

`R6`: clearance is multi-unit — department, faculty, library, bursary, student affairs — and a
single unreturned library book keeps a student off the list.

```
ClearanceRequest (student, type: GRADUATION | WITHDRAWAL | TRANSFER)
   └── ClearanceStep[] (one per required unit)
          status: PENDING | CLEARED | BLOCKED
          blocked_reason, cleared_by, cleared_at, evidence
```

Design choices:
- **Steps are configurable per institution** — which units and whether ordering is enforced
  (bursary commonly last) is `Q-27`
- **Steps run in parallel by default** — serialising library behind department wastes weeks
- **Blocking is explicit and actionable**: the student sees *which* unit blocked them and *why*
  ("Library: 1 book outstanding — *Digital Systems Design*, due 12 Mar"), not a generic failure
- **Overall clearance is derived** from steps (INV-16 pattern), never a separate flag

## 14.2 Graduation evaluation

```
For each final-year / spill-over student:
  1. All curriculum requirements met for their PINNED curriculum version?   (INV-7)
  2. Any outstanding carryover?          → SPILL_OVER, excluded from list   (R6)
  3. Minimum total units achieved?                                          (Q-03)
  4. CGPA ≥ minimum for award?                                              (Q-04)
  5. Within maximum duration?                                               (R5, §8.4)
  6. All clearance steps CLEARED?                                           (§14.1)
  7. No outstanding financial obligation?                                   (§11.4)
     ↓ all pass
  GraduationCandidate created with computed classification                  (Q-01, Q-02)
```

`R6` is unambiguous: a student cannot graduate with outstanding carryovers; all courses
including retaken ones must be passed before Senate approval. Spill-over students are excluded
from the graduation list and must return to clear them.

> **Flagged, not implemented:** `R6` notes some universities allow *conditional release* of
> results for NYSC mobilisation pending clearance of one final carryover. This is a significant
> policy exception with real downstream consequences. It is **not** built in unless the
> institution confirms it — `Q-28`.

## 14.3 Senate approval and the two lists

The distinction from `R6`, modelled explicitly because getting it wrong blocks NYSC:

```
GraduationList  = all approved graduates, by department and batch
SenateList      = per-graduate vetted record for NYSC mobilisation
```

A student may be on the Graduation List but absent from the Senate List, and then cannot
mobilise. The system tracks both and **surfaces the discrepancy as an alert**, because the gap
is otherwise invisible until the student discovers it at camp.

```
Departmental compilation
        ↓
Faculty board screening
        ↓
Senate/Academic Board approval  ──▶ SenateApproval (date, minute reference, approver)
        ↓
Records frozen: transcripts and statements become issuable
        ↓
GraduationList generated ──▶ SenateList entries ──▶ export to NYSC / NERD   (Q-19)
        ↓
Student status → GRADUATED; account converts to ALUMNUS                     (Q-40)
```

## 14.4 The date-consistency invariant (INV-18)

`R6` records that the graduation date on a Statement of Result **must match** the Senate list
date, and a discrepancy can get a graduate sent home from orientation camp.

**Enforcement: the date is stored exactly once, on `SenateApproval`.** Every artefact — statement
of result, transcript, Senate List entry, certificate — derives it from that single field. There
is no second column that can drift. This is a one-line schema decision that eliminates an entire
class of real-world harm.

## 14.5 NYSC / NERD export

`R6`: NERD is a mandatory digital clearinghouse under a "No NERD, No NYSC" policy.

Modelled as an `ExportTarget` interface with per-target field mapping, a dry-run validation pass,
a submission record, and reconciliation of acknowledgements. The concrete formats are
institution- and agency-specific (`Q-19`) and are **not** guessed here.

---

*End of Part 2. Platform concerns follow in `04-PLATFORM.md` (§15–§23).*
