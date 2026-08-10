# Specification Provenance — READ FIRST

## Status: DERIVED, NOT SUPPLIED

No specification document was provided for this project. The working directory
`C:\Users\adeto\Desktop\E-portal` was empty at takeover (0 files, 0 directories, no VCS).
A web search for a canonical "CPE510 university e-portal specification" found nothing;
course-specific project briefs sit behind institutional logins.

Therefore the requirements underpinning this blueprint were **reconstructed from public
sources** describing how Nigerian university ePortals actually operate, plus the regulatory
framework they must comply with. This is a *reference specification*, not your specification.

### What this means for review

| | |
|---|---|
| **Trustworthy** | Structural/architectural decisions, security model, identity invariant, workflow *shapes* |
| **Assumed** | Every numeric threshold, fee, deadline, approval chain composition, and naming convention |
| **Unknown** | Your institution's actual regulations, your course's mandated tech stack, your scale |

Every assumed rule is registered in `01-OPEN-QUESTIONS.md` with an ID (`Q-nn`). The blueprint
references those IDs inline. **No flagged rule has been invented into a hard-coded constant** —
all are modelled as configuration, per the instruction to flag rather than invent.

---

## Derived requirement baseline

### R1 — Regulatory context
The National Universities Commission (NUC) sets Benchmark Minimum Academic Standards (BMAS)
binding on all accredited Nigerian universities. Grading, credit load, and degree classification
derive from BMAS, giving broad cross-institution consistency with local variation.

- Grade scale: A=5, B=4, C=3, D=2, E=1, F=0; A=70–100%, pass mark E=40%
- Degree classes (5.00 scale): First 4.50–5.00, 2:1 3.50–4.49, 2:2 2.40–3.49, Third 1.50–2.39, Pass 1.00–1.49
- Credit load: NUC minimum 15 units/semester (except project semesters), maximum 24
- Programme totals: ~120–150 units (4-year), ~150–200 units (5-year: engineering, medicine, law)
- Maximum duration: standard duration + 50% (a 4-year programme allows 6 years)
- A 2017 move to a 4-point scale was reverted; the 5-point scale is current

**Variation observed:** some older institutions and STEM programmes set A at 75% rather than 70%. → `Q-01`

### R2 — Admission pipeline (upstream of this system)
Admission into Nigerian universities is not university-local. It flows:

```
JAMB/UTME registration → CAPS admission offer → candidate accepts on JAMB e-Facility
→ JAMB Matriculation List → institutional onboarding
```

All legitimate admissions must be processed through JAMB and reflected on CAPS to be valid.
**Architectural consequence:** the authoritative origin of a student's identity is external
(JAMB) and institutional (Admissions Office) — never the student. This independently
corroborates the non-negotiable identity rule.

### R3 — Portal module scope (observed across OAU, UNILORIN, UNIOSUN, NMU, and the Euniface SUMS product)
Admission, online clearance, fee payment, course registration, result computation, transcript
processing, hostel allocation, library, staff records — "from admission to graduation."

### R4 — Course registration rules
- Performed at semester start; **failure to register for a course bars the student from sitting its exam**
- Observed load rule: minimum 18, maximum 24 units per semester (institution-specific; NUC floor is 15) → `Q-03`
- Electives frequently offered in pairs — register one of two → `Q-11`
- Registration form unlocks only after preceding forms/payments complete
- Missed-window exception: medical report to Dean within 4 weeks, validated by Director of
  Medical & Health Services, exempts late-registration penalty → `Q-15`

### R5 — Progression, probation, withdrawal
- Common probation trigger: CGPA < 1.00 at session end → repeat the year. Some institutions
  set good standing at CGPA ≥ 1.50 → `Q-04`
- Escalation: fail to clear probation → withdraw from programme → may transfer to another
  programme → fail again → withdraw from University
- **No student may have more than two probation periods in their career** (UNN model)
- Course-count trigger: accumulating ~5–6 carryovers can force withdrawal → `Q-05`
- Retake allowed at next opportunity provided semester total ≤ 24 units
- **CGPA treatment of retakes is genuinely divergent** — dilution (all attempts count) vs
  best-grade (highest counts, failure shown on transcript but excluded from denominator) → `Q-02`
- Prerequisite failure blocks registration for dependent higher-level courses

### R6 — Graduation, clearance, NYSC
- No graduation with outstanding carryovers; final-year students with carryovers enter
  **spill-over** status and are excluded from the graduation list
- Clearance is multi-unit: department, faculty, library, bursary, student affairs
  (an unreturned library book blocks the list)
- Department → faculty → **Senate/Academic Board approves results and declares graduates**
- **Graduation List ≠ Senate List.** Graduation List = all graduates by department/batch.
  Senate List = per-graduate record vetted for NYSC mobilisation. Absent from the Senate List,
  NYSC registration is impossible even if on the Graduation List.
- Statement of Result graduation date **must match** the Senate list date — mismatches get
  students sent home from orientation camp. This is a data-integrity requirement, not cosmetic.
- **NERD** (Nigeria Education Repository and Databank) is a mandatory verification
  clearinghouse — "No NERD, No NYSC" → `Q-19`

### R7 — Transcripts
- Senate-authenticated transcript (university seal + Registrar signature) is the only version
  accepted for NYSC, foreign study, professional registration, regulated employment
- "Directorate" transcripts are internal and not accepted for formal verification
- Provisional transcript issued pre-convocation; final transcript post-convocation carries
  the degree class

### R8 — Payments
- **Remita/RRR dominates** tertiary and federal collections (TSA legacy). Adopted by UNILAG,
  UI, FUTA, OAU, UNIUYO. Student generates an RRR on the portal, then pays by card or at any
  bank. Every RRR is unique, bound to one amount and purpose, non-reusable.
- Alternatives: Paystack, Flutterwave, Monnify, Interswitch, Squad, eTranzact.
  Local card ~1.5% (capped ~₦2,000), international 3.5–3.9%, settlement T+1.
- Monnify-style **dedicated virtual accounts** give each student a unique account number —
  materially simplifies auto-reconciliation
- **Failure modes to design for explicitly:** exact-amount mismatch produces
  underpayment/overpayment errors that stall the transaction; a generated-but-unpaid RRR
  sits "Pending" indefinitely

### R9 — Data protection
The Nigeria Data Protection Act (NDPA) 2023 governs processing of the personal data this
system holds (biometrics, health records for medical exemptions, financial records).
Compliance obligations are not optional. → `Q-20`

### R10 — Access-control model (drives §5)
NIST defines three RBAC tiers: Core (users→roles→permissions), Hierarchical (senior roles
inherit junior permissions), Constrained (separation-of-duty). University structure maps
cleanly onto role hierarchy (Dean → HOD → Lecturer).

**Critical design warning:** encoding scope into role *names* (`chem_dept_lecturer`,
`physics_dept_lecturer`) causes **role explosion** — hundreds/thousands of roles, unmanageable.
Industry guidance converges on a **hybrid RBAC+ABAC** model: a small set of role types, each
*assignment* bound to a scope tuple; the role grants the verb, attributes constrain the object set.

Also flagged by sources and directly applicable here:
- **Separation of duties** is explicitly relevant to academic workflows — "grade submission vs
  grade approval" is cited as a canonical SOD case
- **Attribute data quality is part of the security perimeter** — if enrolment/appointment data
  is wrong, ABAC scoping silently fails open
- Lifecycle churn (student → TA → adjunct) demands joiner-mover-leaver automation, access
  reviews, and watch for privilege creep and orphaned accounts

### R11 — Result approval chains in practice (drives §10)
**Kwara State Polytechnic** runs a production multi-level chain: Lecturer → HOD/Coordinator →
Director → Academic Board, producing transcripts, statements of result, carry-over reports,
graduation lists and board summaries.

**Busitema University** shows an important upstream control: assessment *components and their
weightings* (e.g. coursework 30% / exam 70%) are set by the HOD when allocating the course to
the lecturer — the lecturer cannot choose their own weighting. This is a real integrity control
and is adopted in §10.

**Portsmouth** shows the QA layer: cross-checking between lecturers, double-marking of major
projects with a third marker appointed on disagreement.

**Research gap found:** no surveyed system implements a full Lecturer → HOD → Dean → Senate
chain end-to-end. Kwara stops at Academic Board with no Dean tier. Conclusion adopted in §10:
model approval as a **configurable N-stage pipeline** with per-stage roles, reject-with-comment
routing back to the originator, and a locked/immutable state after Senate ratification —
rather than hard-coding any specific chain. → `Q-14`

### R12 — Scalability profile (drives §22)
Registration is a **thundering-herd** event, structurally closer to flash-sale commerce than to
normal web traffic — near-zero baseline, then up to a **50× surge** when the window opens,
driven by scarcity (students racing before classes fill).

Key findings adopted:
- **Sizing for averages is the classic failure.** SLAs must specify availability during
  critical academic windows, not annual averages
- **Scheduled pre-scaling beats reactive autoscaling** — registration dates are known months
  ahead; reactive scaling is too slow (metric interval + boot + bootstrap + health check)
- **Virtual waiting rooms / staggered windows** are widely used: King's College London reported
  an 80% reduction in support requests; Swinburne protects registration for 25,000+ students
- **Horizontal scaling does not fix the seat race.** In-process locks and singletons break under
  multi-node deployment; distributed correctness requires DB-level optimistic locking, atomic
  decrements, or a reservation service
- **Graceful degradation:** keep the core write path (add/drop) alive, shed degree-audit,
  schedule visualisation, and analytics under load

### R13 — Tamper-evident audit (drives §19)
**Append-only ≠ tamper-evident.** A table is append-only only by convention; anyone with
sufficient access can still alter history. Tamper-evidence instead makes alteration *detectable*.

Design adopted:
- DB-level trigger raising an exception on UPDATE/DELETE — enforce immutability at the
  database, not just in code; app role gets INSERT/SELECT only
- Hash chain: each row stores sequence number, `prev_hash`, and own hash = SHA-256 over
  (prev_hash, seq, canonical JSON of semantic fields); genesis constant for the first row
- Concurrency: a **Postgres advisory lock** serialises appends so two concurrent inserts cannot
  chain off the same predecessor
- **Anchoring is the part most designs get wrong** — a self-contained chain cannot detect a
  privileged rewrite of the whole table. The root must be published where the log operator
  cannot reach it (object-locked bucket, third-party timestamp service, external ledger)
- **Erasure tension:** crypto-erasure (encrypt personal fields, destroy keys) preserves the
  chain because the hashed ciphertext bytes are unchanged — this reconciles §19 with NDPA
- Meta-audit via `pgaudit` logging reads *of* the audit table

Calibration note taken from the same source: cryptographic tamper-evidence is for a specific
threat model, not a default. Applied here **only** to result, finance, and identity-mutation
events — not to all logging. Note also that AWS shut down QLDB in July 2025, so managed
ledger dependencies are a supply risk.

### R14 — Biometrics (drives §20, `Q-20`)
JAMB already captures fingerprints and photographs at UTME registration, motivated by
impostor-sitting. Token-based exam admission (ID cards, fee clearance cards) is recognised as
weak — losable, stealable, forgeable.

Nigerian deployments and reported figures: OBCAMS at Covenant University, 60 students, 89.33%
first-attempt accuracy; FiBSAMS at TASUED, 100 candidates; a 630-student study reporting 95.3%
verification accuracy, <10% false-positive rate, 47.5% reduction in admittance time.

Two conclusions: (a) accuracy rates in the 89–95% range mean **a manual fallback path is
mandatory**, never biometric-only; (b) linking to the central student database removes the need
for a separate biometric enrolment phase. Biometrics are sensitive personal data under NDPA. → `Q-20`

### R15 — Data protection: NDPA 2023 (drives §20, `Q-29`)
Nigeria's first comprehensive data protection law, effective **12 June 2023**, replacing the
NDPR 2019 and establishing the **NDPC** as regulator.

Obligations directly binding on this system:
- **Registration as a controller of "major importance"** — NDPC guidance sets the threshold at
  processing personal data of **more than 200 data subjects within six months**. Any university
  portal crosses this immediately.
- **Mandatory DPO** with expert knowledge, to advise, monitor compliance, and act as NDPC contact
- **Lawful basis** required; where consent is used it must be explicit, freely given, specific,
  informed, unambiguous
- **Breach notification to NDPC within 72 hours** where high risk; immediate notice to affected
  individuals; maintain a **breach register**
- **Technical/organisational measures**: encryption, resilience, backups, testing, risk assessments
- **Processor contracts** in writing; sub-processor notification
- **Cross-border transfer restrictions** — prohibited absent adequacy, BCRs, or contractual
  clauses. *Directly constrains the hosting decision in §22 — offshore cloud is not a free choice.*
- **DPIA** required; data-subject rights incl. objection, automated-decision-making, portability
- **Penalties:** up to ₦10m or 2% of annual gross revenue (major importance), ₦2m or 2% otherwise;
  non-compliance with NDPC orders can attract up to 1 year imprisonment

### R16 — Real portal topology (from live fetch of UNIOSUN e-portal)
Live inspection of an operating Nigerian university e-portal reveals institutions run **many
separate portals**, not one system. Enumerated at UNIOSUN:

| Portal | Purpose |
|---|---|
| Pre-Degree | Application, admission status, returning students |
| CPAS | JUPEB & part-time programmes |
| **SIWES** | Students Industrial Work Experience Scheme |
| Undergraduate Admission | UTME/DE applications & screening results |
| Undergraduate Students | Course registration, results, student records |
| Postgraduate | PGD, Masters, PhD applications |
| **Online Transcript** | Transcript requests & tracking (separate system) |
| Miscellaneous Payments | Certificates, verification fees, sundry charges |
| Staff Directory | Academic/non-academic staff lookup |
| Alumni | Alumni network |
| **Parents Portal** | "Track your ward's academic progress" (marked Coming Soon) |
| **NELFUND** | Federal student loan portal (external: portal.nelf.gov.ng) |

**Consequences adopted into the blueprint:**

1. **Student categories are plural, not singular.** UTME, Direct Entry, JUPEB, part-time,
   pre-degree, postgraduate, and international students have materially different rules for
   admission, level placement, fees, and duration. A single `Student` type is wrong. → `Q-36`
2. **SIWES is a first-class academic activity** (industrial attachment), typically credit-bearing
   with its own assessment and logbook. Absent from all my earlier search results. → `Q-37`
3. **A parent/guardian role exists** — read-only visibility into a ward's progress. This is a
   distinct principal type with consent implications under NDPA. → `Q-38`
4. **NELFUND (federal student loans)** is an external funding source affecting fee status. A
   student may be cleared for registration via an approved loan rather than direct payment.
   This changes the finance model's assumption that fee clearance == payment received. → `Q-39`
5. **Transcript processing is commonly a separate system** with its own request/tracking
   lifecycle — supports treating it as a bounded context (§13).
6. **Miscellaneous payments** (certificate fees, verification fees) are a distinct revenue
   stream from tuition — the finance model needs arbitrary payable items, not just school fees.
7. **Alumni are a post-graduation principal**, needed for verification and transcript requests
   years after graduation. Account lifecycle must outlive enrolment. → `Q-40`

---

## Sources

- [NUC 5-point CGPA, classification and credit load — OpenEduCat](https://openeducat.org/gradebook/nigeria/university/)
- [Nigeria university grading system explained](https://openeducat.org/articles/nigeria-university-grading-system-cgpa-explained/)
- [NUC push for the five-point grading system — Campus Reporter](https://campusreporter.africa/nuc-wants-universities-to-use-five-point-grading-system/)
- [Carryover and spill-over: rules, limits, graduation impact](https://openeducat.org/gradebook/nigeria/reattempt/)
- [University of Nigeria Nsukka academic regulations (DOC)](https://www.unn.edu.ng/wp-content/uploads/2016/08/UNN-REGULATIONS.doc)
- [UNILAG regulations for the award of undergraduate degrees (PDF)](https://ice.unilag.edu.ng/resources/studentguide.pdf)
- [Nigeria university transcripts: format, NYSC, verification](https://openeducat.org/gradebook/nigeria/transcripts/)
- [How to check the NYSC Senate List and resolve errors](https://nyscwhatsappgroup.com/nysc-senate-list/)
- [JAMB Central Admissions Processing System (CAPS)](https://www.jamb.gov.ng/caps)
- [What CAPS is and how it works for JAMB admission processing](https://educeleb.com/what-is-caps-and-how-does-it-work-for-jamb-admission-processing/)
- [OAU ePortal: course registration, payments, results](https://gmposts.com/oau-eportal-how-to-register-courses-make-payments-and-check-results-online/)
- [UNIOSUN E-Portal](https://uniosun.edu.ng/e-portal/)
- [Euniface Smart University Management System](https://nmu-eportal.com/)
- [Unilorin Portal](https://portal.unilorin.edu.ng/)
- [Remita RRR generation and payment flow](https://gopius.com/how-to-generate-and-make-remita-rrr-payment-in-nigeria/)
- [How Remita makes school fee payment easy — TechBuild Africa](https://techbuild.africa/how-remita-makes-payment-of-school-fees-easy/)
- [Best online payment gateways in Nigeria — fees and comparison](https://awajis.com/online-payment-gateways-in-nigeria/)
- [NCAT Zaria school fee payment procedure](https://ncat.gov.ng/school-fee-payment-procedure/)
- [SRS for Student Information Management System (IEEE 830 template)](https://www.academia.edu/24648944/SOFTWARE_REQUIREMENTS_SPECIFICATION_SRS_FOR_STUDENT_INFORMATION_MANAGEMENT_SYSTEM)
- [CSUN Student Course Information System SRS](https://www.ecs.csun.edu/~rlingard/COMP380/srs.htm)
- [What to look for in a higher-ed SIS — Modern Campus](https://moderncampus.com/blog/what-to-look-for-in-a-student-information-system-for-higher-ed.html)

### Access control, audit, scale, verification
- [NIST RBAC implementation guide — IBM](https://www.ibm.com/think/topics/role-based-access-control-implementation)
- [RBAC vs ABAC: advantages, disadvantages, differences — Syteca](https://www.syteca.com/en/blog/rbac-vs-abac)
- [Role-based access control guide — Netwrix](https://netwrix.com/en/resources/blog/role-based-access-control-rbac-guide/)
- [Tamper-evident audit trails in PostgreSQL with hash chaining — AppMaster](https://appmaster.io/blog/tamper-evident-audit-trails-postgresql)
- [Immutable audit log with HMAC hash chaining — Tracehold](https://tracehold.ai/blog/immutable-audit-log-hmac-hash-chain/)
- [Merkle hash chain audit logs: when you actually need tamper-proof logging](https://dipankar-das.com/blog/merkle-hash-chain-audit-logs/)
- [Why universities run registrations with online queue systems — Queue-it](https://queue-it.com/blog/university-registrations-online-queue/)
- [Service-oriented microservice framework for university course registration — ScienceDirect](https://www.sciencedirect.com/science/article/pii/S1877050925027334)
- [Designing a university course registration system — awesome-low-level-design](https://github.com/ashishps1/awesome-low-level-design/blob/main/problems/course-registration-system.md)
- [Managing peak loads on Ellucian Banner — RadView](https://www.radview.com/blog/mastering-peak-loads-a-visual-guide-to-managing-high-traffic-on-ellucian-banner/)
- [Why standard auto-scaling fails for event-driven traffic spikes — MojoAuth](https://mojoauth.com/blog/why-auto-scaling-fails-event-driven-traffic-spikes)
- [Certifichain: secure QR codes for blockchain-verified credentials — ACM](https://dl.acm.org/doi/full/10.1145/3754458)
- [Blockchain verification: what it is and how it works — Dock](https://www.dock.io/post/blockchain-verification)

### Result workflow, biometrics, data protection
- [Kwara State Polytechnic result processing platform](https://results.kwarastatepolytechnic.edu.ng/)
- [Busitema University: breaking down a course unit and uploading results](https://dicts.busitema.ac.ug/support/staff-portal/breaking-down-course-unit-and-uploading-results)
- [University of Portsmouth: understanding your results (marking/verification)](https://myport.port.ac.uk/my-course/exams/understanding-your-results)
- [Biometrics used to verify students in Nigeria's university entrance exams — ID Tech](https://idtechwire.com/biometrics-verify-students-nigeria-university-entrance-exams-503125/)
- [Biometric secured result processing software for Nigerian tertiary institutions](https://www.academia.edu/85719513/Biometric_Secured_Result_Processing_Software_For_Nigerian_Tertiary_Institutions)
- [E-exams system for Nigerian universities: security and result integrity (arXiv)](https://arxiv.org/pdf/1402.0921)
- [Nigeria Data Protection Act 2023 — official text (PDF)](https://cert.gov.ng/ngcert/resources/Nigeria_Data_Protection_Act_2023.pdf)
- [Nigeria's new Data Protection Act explained — Future of Privacy Forum](https://fpf.org/blog/nigerias-new-data-protection-act-explained/)
- [NDPC guidance on registration of controllers/processors of major importance — KPMG Nigeria](https://kpmg.com/ng/en/home/insights/2024/03/nigeria-data-protection-commissions-guidance-notice-on-registration-of-data-processors-controllers-of-major-importance.html)
- [NDPA overview — Securiti.ai](https://securiti.ai/overview-of-nigeria-data-protection-act/)
