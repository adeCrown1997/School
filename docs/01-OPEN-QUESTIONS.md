# Open Questions & Institution-Specific Rules Register

Status: this register is the single source of truth for everything the blueprint **does not
assume**. Every `Q-nn` referenced from the blueprint resolves here. Review with your course
instructor / institution before Phase 1 begins. IDs marked **[BLOCKER]** must be answered
before the system can be used for real data — they change schema, not just constants.

## A. Grading & computation

### Q-01 [BLOCKER] Grade boundary scale
Observed: NUC default A=70%, but some institutions/STEM programmes use A=75%.
Which scale applies? Full table (A/B/C/D/E/F with percentage bands and grade points) required.
Blueprinted as a configurable `GradeScale` table; **default shipped = NUC 5-point
(A=70, 5 pts)**, flagged clearly in the admin UI until confirmed.

### Q-02 [BLOCKER] CGPA treatment of failed-then-retaken courses
Two incompatible models exist in the wild:
- **Dilution (most common):** all attempts' grade points divided by all attempts' units
- **Best-grade (some federal universities):** highest grade only; failures shown on
  transcript but excluded from the CGPA denominator

This changes the `enrollment_attempt` aggregation core. **Cannot be defaulted safely.**
Needs a decision: one policy university-wide, or per-programme?

### Q-03 Credit load limits
NUC floor 15, ceiling 24; OAU-style observed min 18. What are the institution's actual
min/max per level (100L often has special rules)? Per-programme override capability needed?

### Q-04 Probation threshold
Good standing CGPA ≥ 1.00 (UNN model) vs ≥ 1.50 (stricter institutions). Threshold and
definition of "probation period" (one session? one year?) required.

### Q-05 Carryover-count withdrawal trigger
Some institutions withdraw at N carryovers (5–6 observed). Exact count and whether it is
per-level or cumulative?

### Q-06 [BLOCKER] Degree classification for 4.00–4.49 boundary on converted programmes
If the institution ever ran the 4-point scale, historical records need a mapping. Only
relevant if legacy data exists. (Recorded for completeness — likely a non-issue.)

## B. Curriculum & registration

### Q-07 Course ID / course code format
E.g., `CPE510` → 3-letter prefix + 3 digits. Level-encoded by first digit (500-level)?
Format must match legacy registration patterns if any.

### Q-08 Matriculation number format
Institution-specific format and the sequence rules for generation (year prefix? programme
code? checksum?). **The system generates it — the student never does.** Also: how are
pre-existing students (transfer-in, legacy data) assigned numbers?

### Q-09 Semester naming / academic calendar
Two-semester (Harmattan/Rain) vs semester+summer vs trimester? Session start months?
Where does the official academic calendar live as the source of truth (portal vs registry)?

### Q-10 Elective pairing rule
"Offer electives in pairs, register one of two" — is this institution-wide or departmental?
Enforced as constraint or advisory?

### Q-11 Prerequisite enforcement model
Hard-block registration, or warn-only with HOD override? Most institutions have override
channels for exceptional cases.

### Q-12 Course registration approval chain
Student → Course Adviser → HOD? Who signs off, and is approval mandatory before exam
eligibility, or merely administrative?

### Q-13 Registration dates & late-registration penalty
Window open/close dates per semester (central config vs per-department), late fee rules,
medical-exemption mechanism (R4) — exact validation authority and who grants it.

## C. Results

### Q-14 [BLOCKER] Result approval chain & who enters what
Observed: lecturer entry → department → faculty board → Senate approval → publication.
Who is the minimum approver for provisional publication, and who formally publishes?
Is Senate approval represented as a ceremony (a Senate meeting date) or a named officer
(Registrar delegated)? This determines the workflow engine's approval levels.

### Q-15 Result amendment process
Post-approval corrections: formal "Result Amendment" form, requires which signatories,
what happens to audit trail and to already-printed transcripts? (Blueprint assumes: never
delete, never overwrite; superseding version + full audit.)

### Q-16 Grade entered out of the institution's scale
E.g., lecturer enters a 4.7 on a 5-point course. Reject hard, or accept-and-flag for
checking? (Blueprint assumes hard reject + audit.)

## D. Fees & finance

### Q-17 [BLOCKER] Fee structure model
Per-level flat fee? Fee groups (school charges + faculty + department + hostel +
accommodation)? Split into multiple payment items or one invoice? Does fee liability attach
to the student or the admission offer? What's the refund policy/flow (rare but exists)?

### Q-18 Payment gateway(s) in use
Remita (RRR), Paystack, Flutterwave, Monnify, Interswitch — which is/are actually mandated?
Is bank-branch payment a requirement (RRR payable at bank counters), or online-only?
Whether gateway webhook reliability can be assumed (some networks drop callbacks — the
blueprint therefore includes reconciliation via status polling regardless).

### Q-19 NYSC / NERD export obligations
Does the institution expect the portal to produce the Senate List upload format and NERD
submission? Which registrar-side system consumes the export? (Blueprint provides an
extensible exporter interface; the concrete mapping is institution-specific.)

## E. Identity & admission

### Q-20 Identity verification standards for activation
- What documents must a student present to activate their pre-created record?
  (JAMB registration number + DOB is the observed minimum; some require fee payment first,
  some require the admission letter code.)
- Is biometric (fingerprint) capture in scope? It is standard at Nigerian universities and
  touches hardware + NDPA 2023 sensitivity.
- Do staff have an institutional SSO/LDAP/Active Directory to integrate, or local accounts?

### Q-21 Name/DOB corrections
Formal amendment workflow requiring which authority (Registry) and what evidence
(affidavit + birth certificate)? Who may approve — Registrar only?

### Q-22 Legacy data
Is there an existing SIS (or Excel) to migrate? Record count, quality, duplicates,
existing matric numbers, historical results (need Q-06 mapping if 4-point era)? This drives
Phase 3 (migration) scope.

## F. Examinations

### Q-23 Exam card / exam conduct rules
Conditions to generate an exam card: registered + fees cleared + minimum attendance (e.g.,
75%)? Is attendance tracked in this system or by departments? Who issues and prints cards?

### Q-24 Examination malpractice process
In-scope (case entry, panel minutes, penalties applied to results) or handled entirely
off-system? If in-scope, who enters, who adjudicates, and do penalties post to the same
result records (then Q-15's amendment chain applies)?

## G. Transcripts & certificates

### Q-25 Transcript request workflow
Fee per copy? Who validates and dispatches (Academic Office / Exam & Records)?
Despatch channel (print + post, email PDF, both)? Signed-PDF requirement (certified
digital signature, QR verification) — is the institution ready for that infrastructure?

### Q-26 Statement of Result vs Transcript
Two distinct artefacts in practice. Both in scope? Statement of Result printed on security
paper — in-scope or handled by a separate records office system?

## H. Clearance & graduation

### Q-27 [BLOCKER] Clearance units and ordering
Which units sign off (observed: dept, faculty, library, bursary, student affairs, plus
hostel, health, sports in some institutions), and is ordering mandatory (bursary last) or
parallel? Is a digital clearance form per unit (signed by which staff role) or a single
aggregate form?

### Q-28 Spill-over / graduation-list rules
Defined by rules already covered (Q-02, Q-05) plus: who compiles the graduation list
(Registry?), who approves (Senate), and how is the Senate List export produced?

## I. Legal, privacy & policy

### Q-29 NDPA 2023 compliance scope
DPO appointment? Consent language? Data-subject-access requests in scope? Retention periods
for biometrics and academic records (blueprint default: academic records permanent,
biometrics deletable on request)? → design a DPO/legal review gate in Phase 1.

### Q-30 Email/SMS infrastructure
Is the institution prepared to run transactional email/SMS at scale (dedicated domain,
SPF/DKIM, shortcode)? Or should notifications degrade to in-app-only in Phase 1? (Blueprint
default: in-app + email with SMS behind a toggle.)

### Q-31 Physical verification points
Which transactions need a physical counter-verification (original certificate checks,
paper transcript collection) that the portal cannot digitize?

## J. Project constraints

### Q-32 [BLOCKER] Mandated technology stack
Is this a coursework deliverable with a required language/framework/DB (e.g., PHP/Laravel +
MySQL)? The blueprint's default (below) is chosen for production-grade correctness; a
mandated stack overrides it. **This is the single highest-impact question.**

### Q-33 Deployment environment & realistic scale
On-prem university server vs cloud; expected student population; expected concurrency at
registration/results-release peaks. Drives replica counts, queue sizing, and whether k8s is
justified. Blueprint assumes: 30k students, 3–5k concurrent at registration peak,
2–3 node cluster — adjust.

### Q-34 Team & timeline
Who implements (this project's owner + classmates?), semester duration, review gates. Drives
roadmap scope per phase (the roadmap in §24 is sized for a ~12-week full-time build).

### Q-35 Ownership of the "system clock" for academic calendar events
Which role configures session/semester/registration/result-release dates? (Blueprint:
Registrar/Admin only, audit-logged, with dual-approval for result-release dates.)

## K. Scope questions raised by live portal inspection

These emerged from fetching an operating Nigerian university e-portal, which runs a dozen
separate portals. They are scope questions — each could double the build.

### Q-36 [BLOCKER] Which student categories are in scope?
Observed in production: UTME entrants, Direct Entry, JUPEB, part-time/CPAS, pre-degree,
postgraduate (PGD/Masters/PhD), international, and returning students. Each differs in
admission route, entry level, duration, fee schedule, and progression rules.
**A single `Student` type cannot express this.** The blueprint models
`ProgrammeType` + `EntryMode` + `StudyMode` as first-class, but the *rules* per category
are institution-specific. Minimum viable answer: which one or two categories does Phase 1 cover?

### Q-37 Is SIWES (industrial attachment) in scope?
Credit-bearing industrial placement with its own portal at the surveyed institution.
If in scope: logbook submission, supervisor assessment, placement records, and how the
SIWES grade enters the CGPA. Substantial additional module.

### Q-38 Parent/guardian portal in scope?
Observed as "Coming Soon" at the surveyed institution — read-only view of a ward's progress.
Raises NDPA questions: what is the lawful basis for disclosing an adult student's academic and
financial records to a parent? Is student consent required and revocable? Blueprint's position:
**model the role, ship it disabled, require explicit student-granted consent** — but the policy
is yours to set.

### Q-39 [BLOCKER] NELFUND / student loan integration
The federal student loan portal is linked directly from the surveyed e-portal. This breaks the
naive assumption that *fee cleared == money received*. A student may be registration-eligible on
the strength of an approved loan disbursing later. Questions: does the portal integrate with
NELFUND, or does the Bursary manually record loan-backed clearance? Who bears the reconciliation
risk if a loan fails to disburse after the student has registered and sat exams?

### Q-40 Alumni lifecycle
Alumni need portal access years after graduation for transcripts and verification. Does the
account persist indefinitely? Does it convert to an alumni principal with reduced scope? What is
the retention policy for a graduate's account credentials vs their academic record (which is
permanent)?

### Q-41 Postgraduate academic rules
If PG is in scope: different grading (often 4-point or different classification), thesis/
dissertation workflow, supervisor allocation, defence scheduling, and a different progression
model entirely. Blueprint treats PG as **out of scope for Phase 1** unless you say otherwise.

### Q-42 Multi-portal vs unified system
Real institutions run admission, undergraduate records, transcripts, and payments as separate
deployed systems. Is the goal to build **one unified portal** (this blueprint's assumption,
enabled by modular monolith boundaries), or to replace only one of these portals and integrate
with the others? If integrating, integration contracts with existing systems become the
dominant design constraint and much of this blueprint changes.
