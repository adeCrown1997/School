import { ScopeType } from '@prisma/client';
import { PERMISSIONS, PermissionKey } from './permissions.catalog';

/**
 * ROLE CATALOG for Phase 1. Each role is the minimum set of permissions needed
 * to do its job (least privilege). Scope is NOT encoded in role names — a role
 * is granted to a user WITHIN a scope (GLOBAL / FACULTY / DEPARTMENT /
 * PROGRAMME) via RoleAssignment. `scopeKind` is the widest scope at which the
 * role is normally assigned; it constrains assignment, not permission meaning.
 *
 * IMPORTANT: SUPER_ADMIN does NOT get a wildcard. It is granted the full set
 * explicitly, so the permission catalog remains the single source of truth and
 * "what can the super admin do" is always auditable. Even SUPER_ADMIN is not
 * granted any capability to mutate protected identity fields directly — those
 * only move through the amendment/change-request workflow (STUDENTS_AMEND
 * approves; it does not bypass the DB trigger).
 */
export interface RoleDef {
  key: string;
  name: string;
  description: string;
  scopeKind: ScopeType;
  permissions: PermissionKey[];
}

const P = PERMISSIONS;

// Reusable bundles.
const STUDENT_READONLY: PermissionKey[] = [P.STUDENTS_VIEW, P.STRUCTURE_VIEW];
// Read-only visibility into the Phase 2 academic structure. Grading/credit
// CONFIG is deliberately excluded — that is institutional setup, not a viewer
// concern (least privilege).
const ACADEMIC_READONLY: PermissionKey[] = [P.COURSES_VIEW, P.CURRICULUM_VIEW, P.OFFERINGS_VIEW];

export const ROLE_DEFS: RoleDef[] = [
  {
    key: 'SUPER_ADMIN',
    name: 'Super Administrator',
    description: 'Full administrative authority over the platform configuration and RBAC.',
    scopeKind: ScopeType.GLOBAL,
    // Explicit full set (see note above) — assembled at seed time from the catalog.
    permissions: Object.values(P) as PermissionKey[],
  },
  {
    key: 'ADMINISTRATOR',
    name: 'Administrator',
    description:
      'Manages staff accounts, university structure and dashboards; not full RBAC authority.',
    scopeKind: ScopeType.GLOBAL,
    permissions: [
      P.USERS_VIEW,
      P.USERS_CREATE,
      P.USERS_UPDATE,
      P.USERS_DEACTIVATE,
      P.USERS_RESET,
      P.ROLES_VIEW,
      P.ROLES_ASSIGN,
      P.PERMISSIONS_VIEW,
      P.STRUCTURE_VIEW,
      P.STRUCTURE_MANAGE,
      // Academic structure — full authority at GLOBAL scope (Phase 2).
      P.COURSES_VIEW,
      P.COURSES_CREATE,
      P.COURSES_UPDATE,
      P.COURSES_DEACTIVATE,
      P.CURRICULUM_VIEW,
      P.CURRICULUM_MANAGE,
      P.CURRICULUM_PUBLISH,
      P.OFFERINGS_VIEW,
      P.OFFERINGS_MANAGE,
      P.ACADEMIC_CONFIG_VIEW,
      P.ACADEMIC_CONFIG_MANAGE,
      // Registration: an administrator oversees the process and can correct a
      // student's list, but does NOT hold registration.approve. The approval
      // chain is an ACADEMIC judgement (adviser → HOD), and an actor who can
      // both edit a course list and approve it is a one-person registration.
      P.REGISTRATION_VIEW,
      P.REGISTRATION_MANAGE,
      P.REGISTRATION_LOCK,
      // Results: oversight only — view in-scope batches and co-sign the
      // dual-control publication. Approve is the academic chain's; score entry
      // belongs to the allocated lecturer (§10).
      P.RESULTS_VIEW,
      P.RESULTS_PUBLISH,
      // Finance oversight: dashboards reconcile expected vs received, so the
      // administrator reads the ledger — but never posts or waives (that is the
      // bursary's ledger authority).
      P.FINANCE_VIEW,
      P.FINANCE_RECONCILE,
      P.EXAMS_VIEW,
      P.CLEARANCE_VIEW,
      P.GRADUATION_VIEW,
      P.TRANSCRIPTS_VIEW,
      P.STUDENTS_VIEW,
      P.AUDIT_VIEW,
      P.DASHBOARD_ADMIN_VIEW,
    ],
  },
  {
    key: 'REGISTRY_OFFICER',
    name: 'Registry Officer',
    description: 'Owns the student master record: create, import, amend, review change requests.',
    scopeKind: ScopeType.GLOBAL,
    permissions: [
      P.STUDENTS_VIEW,
      P.STUDENTS_CREATE,
      P.STUDENTS_UPDATE,
      P.STUDENTS_IMPORT,
      P.STUDENTS_ACTIVATE,
      P.STUDENTS_STATUS,
      P.STUDENTS_AMEND,
      P.CHANGE_REQUESTS_VIEW,
      P.CHANGE_REQUESTS_REVIEW,
      P.STRUCTURE_VIEW,
      ...ACADEMIC_READONLY,
      // Registry locks approved registrations and rules on exceptions (late
      // registration, unit overrides). Not approve: the academic chain decides
      // whether the course list is sound; registry makes it final.
      P.REGISTRATION_VIEW,
      P.REGISTRATION_LOCK,
      P.REGISTRATION_EXCEPTION_REVIEW,
      // Results administration: registry places/releases withholdings (§10.7),
      // co-signs publication, and sees the pipeline. It never enters or approves
      // marks — that stays with the academic chain.
      P.RESULTS_VIEW,
      P.RESULTS_WITHHOLD,
      P.RESULTS_PUBLISH,
      // Clearance & graduation: registry runs the evaluation, records Senate
      // approval, and finalises the two lists (§14). Senate APPROVAL is a
      // separate key from evaluation precisely so the same office cannot both
      // run the numbers and ratify them unseen.
      P.CLEARANCE_VIEW,
      P.CLEARANCE_SIGN,
      P.CLEARANCE_WAIVE,
      P.GRADUATION_VIEW,
      P.GRADUATION_EVALUATE,
      P.GRADUATION_APPROVE,
      // Credentials: transcript requests are reviewed and dispatched here.
      P.TRANSCRIPTS_VIEW,
      P.TRANSCRIPTS_REVIEW,
      P.AUDIT_VIEW,
      P.DASHBOARD_ADMIN_VIEW,
      P.DASHBOARD_REGISTRY_VIEW,
    ],
  },
  {
    key: 'ADMISSIONS_OFFICER',
    name: 'Admissions Officer',
    description:
      'Creates/imports newly admitted student records; does not amend existing identity.',
    scopeKind: ScopeType.GLOBAL,
    permissions: [
      P.STUDENTS_VIEW,
      P.STUDENTS_CREATE,
      P.STUDENTS_IMPORT,
      P.STRUCTURE_VIEW,
      P.DASHBOARD_ADMIN_VIEW,
      P.DASHBOARD_ADMISSIONS_VIEW,
    ],
  },
  {
    key: 'FACULTY_OFFICER',
    name: 'Faculty Officer',
    description: 'Views students and academic structure within their faculty scope.',
    scopeKind: ScopeType.FACULTY,
    permissions: [
      ...STUDENT_READONLY,
      ...ACADEMIC_READONLY,
      P.DASHBOARD_ADMIN_VIEW,
      P.DASHBOARD_FACULTY_VIEW,
      P.REGISTRATION_VIEW,
      // Faculty collation tier of the result chain (§10.4): view and act at an
      // approval stage in scope.
      P.RESULTS_VIEW,
      P.RESULTS_APPROVE,
    ],
  },
  {
    key: 'HOD',
    name: 'Head of Department',
    description:
      'Leads a department: views students in scope and authors courses/offerings for the department (scope-aware writes).',
    scopeKind: ScopeType.DEPARTMENT,
    // The HOD exercises SCOPE-AWARE WRITES: courses.create/update and
    // offerings.manage are enforced by the scope engine in the service layer,
    // so an HOD can only write within their department. curriculum stays
    // view-only (programme curricula are approved centrally); publishing is not
    // theirs. This is the role the authorization tests target for out-of-scope
    // denial.
    permissions: [
      ...STUDENT_READONLY,
      ...ACADEMIC_READONLY,
      P.COURSES_CREATE,
      P.COURSES_UPDATE,
      P.OFFERINGS_MANAGE,
      // Second stage of the registration chain. Scope-narrowed like the writes
      // above, so an HOD approves only their own department's students.
      P.REGISTRATION_VIEW,
      P.REGISTRATION_APPROVE,
      // §10.1/§10.4: the HOD OWNS the assessment structure (weightings), and is
      // the departmental stage of the result approval chain. Score ENTRY is not
      // here — the HOD approves what allocated LECTURERS enter, and holding both
      // would collapse the separation of duties (§5.4).
      P.RESULTS_VIEW,
      P.RESULTS_ASSESS_MANAGE,
      P.RESULTS_APPROVE,
      P.DASHBOARD_ADMIN_VIEW,
      P.DASHBOARD_HOD_VIEW,
    ],
  },
  {
    key: 'ACADEMIC_ADVISER',
    name: 'Academic Adviser',
    description: 'Views advisees and academic structure within their department/programme scope.',
    scopeKind: ScopeType.DEPARTMENT,
    // First stage of the registration chain — the adviser is the one who
    // actually reads the course list against the curriculum. Cannot lock, so a
    // registration always passes through a second pair of hands.
    permissions: [
      ...STUDENT_READONLY,
      ...ACADEMIC_READONLY,
      P.REGISTRATION_VIEW,
      P.REGISTRATION_APPROVE,
      P.DASHBOARD_ADVISER_VIEW,
    ],
  },
  {
    key: 'DEAN',
    name: 'Dean',
    description:
      'Faculty board approvals: the faculty stage of the result approval chain and oversight of registrations in scope.',
    scopeKind: ScopeType.FACULTY,
    // The Dean is the FACULTY stage of the result chain (§10.4) and ratifies at
    // departmental scope beneath them. No score entry, no publishing — the
    // chain must have at least three distinct hands.
    permissions: [
      ...STUDENT_READONLY,
      ...ACADEMIC_READONLY,
      P.REGISTRATION_VIEW,
      P.REGISTRATION_APPROVE,
      P.RESULTS_VIEW,
      P.RESULTS_APPROVE,
      P.DASHBOARD_ADMIN_VIEW,
      P.DASHBOARD_FACULTY_VIEW,
    ],
  },
  {
    key: 'EXAM_OFFICER',
    name: 'Exam Officer',
    description:
      'Examinations: schedules and venues, eligibility gating, exam-card issuance and hall attendance.',
    scopeKind: ScopeType.FACULTY,
    // Exam officers run the §12 machinery but can never WRITE RESULTS: the
    // examination module raises an assessment amendment instead of editing a
    // grade (§12.5). RESULTS_VIEW is read-only context.
    permissions: [
      ...STUDENT_READONLY,
      ...ACADEMIC_READONLY,
      P.REGISTRATION_VIEW,
      P.RESULTS_VIEW,
      P.RESULTS_WITHHOLD,
      P.EXAMS_VIEW,
      P.EXAMS_MANAGE,
      P.EXAMS_CARD_ISSUE,
      P.DASHBOARD_ADMIN_VIEW,
      P.DASHBOARD_EXAMS_VIEW,
    ],
  },
  {
    key: 'LECTURER',
    name: 'Lecturer',
    description:
      'Teaching staff. Views the academic structure, and enters/submits raw scores for allocated offerings (scope-aware).',
    scopeKind: ScopeType.DEPARTMENT,
    // The lecturer's ONLY result authority is score entry on their offerings
    // (§10.2): they see their own sheet, submit it, then stop. They cannot
    // define weightings (INV-11), approve, publish or withhold — each of those
    // is a different hand in the same chain.
    permissions: [
      P.STRUCTURE_VIEW,
      ...ACADEMIC_READONLY,
      P.RESULTS_SCORE_MANAGE,
      // Lecturers read their OFFERINGS-scoped allocation, never a student
      // directory: no students.view is granted here.
      P.DASHBOARD_LECTURER_VIEW,
    ],
  },
  {
    key: 'LIBRARY_OFFICER',
    name: 'Library Officer',
    description: 'Signs the LIBRARY step of student clearance (loans returned, fines cleared).',
    scopeKind: ScopeType.GLOBAL,
    permissions: [
      ...STUDENT_READONLY,
      P.CLEARANCE_VIEW,
      P.CLEARANCE_SIGN,
      P.DASHBOARD_LIBRARY_VIEW,
    ],
  },
  {
    key: 'STUDENT_AFFAIRS',
    name: 'Student Affairs Officer',
    description:
      'Signs the STUDENT_AFFAIRS and HOSTEL clearance steps; views holds and disciplinary context.',
    scopeKind: ScopeType.GLOBAL,
    permissions: [
      ...STUDENT_READONLY,
      P.CLEARANCE_VIEW,
      P.CLEARANCE_SIGN,
      P.DASHBOARD_AFFAIRS_VIEW,
    ],
  },
  {
    key: 'HOSTEL_OFFICER',
    name: 'Accommodation Officer',
    description: 'Signs the HOSTEL step of student clearance (hall dues and allotment settled).',
    scopeKind: ScopeType.GLOBAL,
    permissions: [...STUDENT_READONLY, P.CLEARANCE_VIEW, P.CLEARANCE_SIGN, P.DASHBOARD_HOSTEL_VIEW],
  },
  {
    key: 'BURSARY_OFFICER',
    name: 'Bursary Officer',
    description:
      'Finance staff: fee schedules, invoicing, payment posting, waivers, loan clearances and reconciliation.',
    scopeKind: ScopeType.GLOBAL,
    // Finance authority lives entirely here (docs/03 §11). Note the SOD shape:
    // WAIVER approval needs a SECOND signature (the service checks the
    // approver differs from the requester), and payment REVERSAL is a new
    // ledger entry, never an edit — so no combination of these keys can
    // silently move money.
    permissions: [
      ...STUDENT_READONLY,
      P.FINANCE_VIEW,
      P.FINANCE_SCHEDULE_MANAGE,
      P.FINANCE_INVOICE_MANAGE,
      P.FINANCE_PAYMENT_MANAGE,
      P.FINANCE_WAIVER_MANAGE,
      P.FINANCE_RECONCILE,
      // The bursary signs the BURSARY step of student clearance.
      P.CLEARANCE_VIEW,
      P.CLEARANCE_SIGN,
      P.DASHBOARD_ADMIN_VIEW,
      P.DASHBOARD_BURSAR_VIEW,
    ],
  },
  {
    key: 'SIWES_COORDINATOR',
    name: 'Project/SIWES Coordinator',
    description:
      'Supervises industrial-training and project students: reviews registrations and results within their department scope.',
    scopeKind: ScopeType.DEPARTMENT,
    // A coordinator's authority is REVIEW: read registrations and results in
    // scope and act at a configurable approval stage, never score entry,
    // locking or publishing — same separation-of-duties shape as the adviser.
    permissions: [
      ...STUDENT_READONLY,
      ...ACADEMIC_READONLY,
      P.REGISTRATION_VIEW,
      P.REGISTRATION_APPROVE,
      P.RESULTS_VIEW,
      P.RESULTS_APPROVE,
      P.DASHBOARD_PROJECT_VIEW,
    ],
  },
  {
    key: 'REGISTRAR',
    name: 'Registrar',
    description:
      'Head of the registry: the whole-institution view of admissions, students, results and graduation.',
    scopeKind: ScopeType.GLOBAL,
    // Read-and-oversight only. The Registrar signs nothing here: approving is
    // the academic chain's, posting money the bursary's, entering marks the
    // lecturers'. Their authority is the institution-wide read.
    permissions: [
      ...STUDENT_READONLY,
      ...ACADEMIC_READONLY,
      P.REGISTRATION_VIEW,
      P.RESULTS_VIEW,
      P.FINANCE_VIEW,
      P.EXAMS_VIEW,
      P.CLEARANCE_VIEW,
      P.GRADUATION_VIEW,
      P.TRANSCRIPTS_VIEW,
      P.AUDIT_VIEW,
      P.DASHBOARD_ADMIN_VIEW,
      P.DASHBOARD_REGISTRAR_VIEW,
    ],
  },
  {
    key: 'VICE_CHANCELLOR',
    name: 'Vice Chancellor',
    description:
      'The principal officer of the university: the executive overview of students, admissions, academics, finance and graduation.',
    scopeKind: ScopeType.GLOBAL,
    // Executive read — every view key, no manage/approve key. A VC who could
    // also edit records would collapse the separation of duties the whole
    // chain is built on; decisions are recorded by the office responsible.
    permissions: [
      ...STUDENT_READONLY,
      ...ACADEMIC_READONLY,
      P.REGISTRATION_VIEW,
      P.RESULTS_VIEW,
      P.FINANCE_VIEW,
      P.EXAMS_VIEW,
      P.CLEARANCE_VIEW,
      P.GRADUATION_VIEW,
      P.TRANSCRIPTS_VIEW,
      P.AUDIT_VIEW,
      P.DASHBOARD_ADMIN_VIEW,
      P.DASHBOARD_VC_VIEW,
    ],
  },
  {
    key: 'STUDENT',
    name: 'Student',
    description:
      'An activated student principal. Can view own profile and raise change requests only.',
    scopeKind: ScopeType.GLOBAL,
    // Deliberately EMPTY. A student can never view OTHER records, create
    // records, or edit protected fields. All student self-service access
    // (/me/*) is authorized by OWNERSHIP in the controller, not by any
    // permission — so the STUDENT role must carry none. In particular it must
    // NOT hold change_requests.view, which guards the REGISTRY list endpoint
    // (all requests in scope); at this role's GLOBAL scopeKind that would let a
    // student enumerate every student's change requests. The same reasoning
    // covers registration.view, which guards the staff endpoint listing every
    // registration in scope; a student reaches their OWN registration through
    // /me/registration, gated on the principal's studentRecordId.
    permissions: [],
  },
];

/** Roles that are seeded as system roles (immutable key/name, undeletable). */
export const SYSTEM_ROLE_KEYS = ROLE_DEFS.map((r) => r.key);
