/**
 * PERMISSION CATALOG — the single source of truth for every capability in the
 * system. Guards reference these keys; the seed writes them to the DB; the
 * grant-authority check reads them. Adding a capability means adding it here
 * AND to at least one role below.
 *
 * Naming: "<resource>.<action>" in lowercase dotted form. Keep granular.
 */
export const PERMISSIONS = {
  // Users / staff accounts
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DEACTIVATE: 'users.deactivate',
  USERS_RESET: 'users.reset',

  // Roles & permissions administration
  ROLES_VIEW: 'roles.view',
  ROLES_CREATE: 'roles.create',
  ROLES_UPDATE: 'roles.update',
  ROLES_ASSIGN: 'roles.assign',
  PERMISSIONS_VIEW: 'permissions.view',

  // University structure
  STRUCTURE_VIEW: 'structure.view',
  STRUCTURE_MANAGE: 'structure.manage',

  // Academic structure — course catalogue (Phase 2)
  COURSES_VIEW: 'courses.view',
  COURSES_CREATE: 'courses.create',
  COURSES_UPDATE: 'courses.update',
  COURSES_DEACTIVATE: 'courses.deactivate',

  // Academic structure — programme curricula (Phase 2)
  CURRICULUM_VIEW: 'curriculum.view',
  CURRICULUM_MANAGE: 'curriculum.manage',
  CURRICULUM_PUBLISH: 'curriculum.publish',

  // Academic structure — course offerings (Phase 2, definition-only)
  OFFERINGS_VIEW: 'offerings.view',
  OFFERINGS_MANAGE: 'offerings.manage',

  // Academic configuration — grading, categories, credit policy (Phase 2)
  ACADEMIC_CONFIG_VIEW: 'academic.config.view',
  ACADEMIC_CONFIG_MANAGE: 'academic.config.manage',

  // Course registration (Phase 2). Five keys rather than a view/manage pair,
  // because the approval chain is a SEPARATION OF DUTIES boundary: the adviser
  // who approves must not be the officer who locks, and neither should be able
  // to edit a student's course list on their behalf. Collapsing these would
  // make that separation unexpressible.
  REGISTRATION_VIEW: 'registration.view',
  REGISTRATION_MANAGE: 'registration.manage', // add/drop on a student's behalf
  REGISTRATION_APPROVE: 'registration.approve', // act at an approval stage
  REGISTRATION_LOCK: 'registration.lock', // freeze an approved registration
  REGISTRATION_EXCEPTION_REVIEW: 'registration.exception.review',

  // Results (Phase 3). Six keys because the result pipeline is THREE separation-
  // of-duties boundaries: whoever defines the assessment structure, whoever
  // enters scores, whoever approves, and whoever publishes must be expressible
  // independently — a lecturer who can also approve and publish their own marks
  // is a one-person examination board (docs/03 §10).
  RESULTS_VIEW: 'results.view',
  RESULTS_ASSESS_MANAGE: 'results.assess.manage', // assessment components (HOD-owned, §10.1)
  RESULTS_SCORE_MANAGE: 'results.score.manage', // enter/submit raw scores
  RESULTS_APPROVE: 'results.approve', // act at a result approval stage
  RESULTS_PUBLISH: 'results.publish', // dual-control publication
  RESULTS_WITHHOLD: 'results.withhold', // place/lift result withholdings

  // Finance (Phase 4). The split mirrors the SOD pairs of docs/02 §5.4: the
  // officer who RAISES an invoice is not the one who WAIVES it, and clearing a
  // waiver requires a second signature — none of which is expressible with a
  // single finance.manage key.
  FINANCE_VIEW: 'finance.view',
  FINANCE_SCHEDULE_MANAGE: 'finance.schedule.manage', // fee schedules & items
  FINANCE_INVOICE_MANAGE: 'finance.invoice.manage', // generate/issue/cancel invoices
  FINANCE_PAYMENT_MANAGE: 'finance.payment.manage', // post payments/reversals to the ledger
  FINANCE_WAIVER_MANAGE: 'finance.waiver.manage', // request/approve waivers & loan clearances
  FINANCE_RECONCILE: 'finance.reconcile', // settlement reconciliation reports

  // Examinations (Phase 5). Card issuance is a separate key from general
  // management: the hall admits on the strength of a card, so who may mint one
  // must be its own grant (docs/03 §12).
  EXAMS_VIEW: 'exams.view',
  EXAMS_MANAGE: 'exams.manage', // periods, venues, schedules, attendance
  EXAMS_CARD_ISSUE: 'exams.card.issue', // issue/invalidate exam cards

  // Clearance & graduation (Phase 6). Sign and waive are distinct keys because
  // waiving a mandatory unit is the exceptional power — the clearance step that
  // would otherwise keep a student off the list (docs/03 §14.1).
  CLEARANCE_VIEW: 'clearance.view',
  CLEARANCE_SIGN: 'clearance.sign',
  CLEARANCE_WAIVE: 'clearance.waive',
  GRADUATION_VIEW: 'graduation.view',
  GRADUATION_EVALUATE: 'graduation.evaluate', // run candidate evaluations
  GRADUATION_APPROVE: 'graduation.approve', // record Senate approvals

  // Credentials (Phase 7)
  TRANSCRIPTS_VIEW: 'transcripts.view',
  TRANSCRIPTS_REVIEW: 'transcripts.review', // review/approve/dispatch requests

  // Student master records
  STUDENTS_VIEW: 'students.view',
  STUDENTS_CREATE: 'students.create',
  STUDENTS_UPDATE: 'students.update', // non-protected/system fields only
  STUDENTS_IMPORT: 'students.import',
  STUDENTS_ACTIVATE: 'students.activate', // admin-initiated (re)activation
  STUDENTS_STATUS: 'students.status', // change academic status (amendment)
  STUDENTS_AMEND: 'students.amend', // approve protected-field amendments

  // Profile change requests (Registry review)
  CHANGE_REQUESTS_VIEW: 'change_requests.view',
  CHANGE_REQUESTS_REVIEW: 'change_requests.review',

  // Audit
  AUDIT_VIEW: 'audit.view',

  // Dashboards
  DASHBOARD_ADMIN_VIEW: 'dashboard.admin.view',

  // Role dashboards. One key per tailored dashboard, mirroring the module split:
  // a role's own dashboard is a read-only projection of what that role may
  // already see, so granting a key here without the underlying module keys
  // yields empty widgets, never out-of-scope data (each service re-derives the
  // caller's scope for every figure it returns).
  DASHBOARD_LECTURER_VIEW: 'dashboard.lecturer.view',
  DASHBOARD_ADVISER_VIEW: 'dashboard.adviser.view',
  DASHBOARD_BURSAR_VIEW: 'dashboard.bursar.view',
  DASHBOARD_HOD_VIEW: 'dashboard.hod.view',
  DASHBOARD_FACULTY_VIEW: 'dashboard.faculty.view',
  DASHBOARD_REGISTRY_VIEW: 'dashboard.registry.view',
  DASHBOARD_ADMISSIONS_VIEW: 'dashboard.admissions.view',
  DASHBOARD_EXAMS_VIEW: 'dashboard.exams.view',
  DASHBOARD_LIBRARY_VIEW: 'dashboard.library.view',
  DASHBOARD_AFFAIRS_VIEW: 'dashboard.affairs.view',
  DASHBOARD_HOSTEL_VIEW: 'dashboard.hostel.view',
  DASHBOARD_PROJECT_VIEW: 'dashboard.project.view',
  DASHBOARD_REGISTRAR_VIEW: 'dashboard.registrar.view',
  DASHBOARD_VC_VIEW: 'dashboard.vc.view',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Human-readable metadata for the admin permissions screen + seed. */
export interface PermissionDef {
  key: PermissionKey;
  category: string;
  description: string;
}

export const PERMISSION_DEFS: PermissionDef[] = [
  { key: PERMISSIONS.USERS_VIEW, category: 'users', description: 'View staff user accounts' },
  { key: PERMISSIONS.USERS_CREATE, category: 'users', description: 'Create staff user accounts' },
  { key: PERMISSIONS.USERS_UPDATE, category: 'users', description: 'Update staff user accounts' },
  {
    key: PERMISSIONS.USERS_DEACTIVATE,
    category: 'users',
    description: 'Deactivate/reactivate accounts',
  },
  {
    key: PERMISSIONS.USERS_RESET,
    category: 'users',
    description: 'Reset another account credentials',
  },

  {
    key: PERMISSIONS.ROLES_VIEW,
    category: 'roles',
    description: 'View roles and their permissions',
  },
  { key: PERMISSIONS.ROLES_CREATE, category: 'roles', description: 'Create custom roles' },
  { key: PERMISSIONS.ROLES_UPDATE, category: 'roles', description: "Edit a role's permissions" },
  { key: PERMISSIONS.ROLES_ASSIGN, category: 'roles', description: 'Assign/revoke roles to users' },
  {
    key: PERMISSIONS.PERMISSIONS_VIEW,
    category: 'roles',
    description: 'View the permission catalog',
  },

  {
    key: PERMISSIONS.STRUCTURE_VIEW,
    category: 'structure',
    description: 'View university structure',
  },
  {
    key: PERMISSIONS.STRUCTURE_MANAGE,
    category: 'structure',
    description: 'Manage faculties/departments/programmes/sessions/semesters',
  },

  {
    key: PERMISSIONS.COURSES_VIEW,
    category: 'courses',
    description: 'View the course catalogue',
  },
  {
    key: PERMISSIONS.COURSES_CREATE,
    category: 'courses',
    description: 'Create courses (incl. prerequisites/relationships)',
  },
  {
    key: PERMISSIONS.COURSES_UPDATE,
    category: 'courses',
    description: 'Update courses and their prerequisites/relationships',
  },
  {
    key: PERMISSIONS.COURSES_DEACTIVATE,
    category: 'courses',
    description: 'Deactivate/reactivate courses',
  },

  {
    key: PERMISSIONS.CURRICULUM_VIEW,
    category: 'curriculum',
    description: 'View programme curricula',
  },
  {
    key: PERMISSIONS.CURRICULUM_MANAGE,
    category: 'curriculum',
    description: 'Create/edit draft curriculum versions and requirements',
  },
  {
    key: PERMISSIONS.CURRICULUM_PUBLISH,
    category: 'curriculum',
    description: 'Publish a curriculum version (freeze it)',
  },

  {
    key: PERMISSIONS.OFFERINGS_VIEW,
    category: 'offerings',
    description: 'View course offerings',
  },
  {
    key: PERMISSIONS.OFFERINGS_MANAGE,
    category: 'offerings',
    description: 'Create/update course offerings',
  },

  {
    key: PERMISSIONS.ACADEMIC_CONFIG_VIEW,
    category: 'academic_config',
    description: 'View grading systems, course categories and credit policy',
  },
  {
    key: PERMISSIONS.ACADEMIC_CONFIG_MANAGE,
    category: 'academic_config',
    description: 'Manage grading systems, course categories and credit policy',
  },

  {
    key: PERMISSIONS.REGISTRATION_VIEW,
    category: 'registration',
    description: 'View course registrations in scope',
  },
  {
    key: PERMISSIONS.REGISTRATION_MANAGE,
    category: 'registration',
    description: "Add/drop courses on a student's behalf",
  },
  {
    key: PERMISSIONS.REGISTRATION_APPROVE,
    category: 'registration',
    description: 'Approve/reject a registration at an approval stage',
  },
  {
    key: PERMISSIONS.REGISTRATION_LOCK,
    category: 'registration',
    description: 'Lock an approved registration (freezes units, issues the slip)',
  },
  {
    key: PERMISSIONS.REGISTRATION_EXCEPTION_REVIEW,
    category: 'registration',
    description: 'Approve/reject registration exceptions (overrides, late registration)',
  },

  {
    key: PERMISSIONS.RESULTS_VIEW,
    category: 'results',
    description: 'View course results, assessments and result batches in scope',
  },
  {
    key: PERMISSIONS.RESULTS_ASSESS_MANAGE,
    category: 'results',
    description: 'Define and update the assessment structure of an offering (weightings)',
  },
  {
    key: PERMISSIONS.RESULTS_SCORE_MANAGE,
    category: 'results',
    description: 'Enter, autosave and submit raw scores for an offering',
  },
  {
    key: PERMISSIONS.RESULTS_APPROVE,
    category: 'results',
    description: 'Approve/reject a result batch at an approval stage',
  },
  {
    key: PERMISSIONS.RESULTS_PUBLISH,
    category: 'results',
    description: 'Co-sign the dual-control publication of a ratified result batch',
  },
  {
    key: PERMISSIONS.RESULTS_WITHHOLD,
    category: 'results',
    description: 'Place or lift a withholding on a result',
  },

  {
    key: PERMISSIONS.FINANCE_VIEW,
    category: 'finance',
    description: 'View fee schedules, invoices, payments, waivers and ledger activity',
  },
  {
    key: PERMISSIONS.FINANCE_SCHEDULE_MANAGE,
    category: 'finance',
    description: 'Create and edit fee schedules and their fee items',
  },
  {
    key: PERMISSIONS.FINANCE_INVOICE_MANAGE,
    category: 'finance',
    description: 'Generate, issue and cancel student invoices',
  },
  {
    key: PERMISSIONS.FINANCE_PAYMENT_MANAGE,
    category: 'finance',
    description: 'Post payments and reversals to the ledger',
  },
  {
    key: PERMISSIONS.FINANCE_WAIVER_MANAGE,
    category: 'finance',
    description: 'Request and approve fee waivers and loan clearances',
  },
  {
    key: PERMISSIONS.FINANCE_RECONCILE,
    category: 'finance',
    description: 'Reconcile provider settlement reports against the ledger',
  },

  {
    key: PERMISSIONS.EXAMS_VIEW,
    category: 'exams',
    description: 'View exam periods, schedules, venues, eligibility and cards in scope',
  },
  {
    key: PERMISSIONS.EXAMS_MANAGE,
    category: 'exams',
    description: 'Manage exam periods, venues, schedules and hall attendance',
  },
  {
    key: PERMISSIONS.EXAMS_CARD_ISSUE,
    category: 'exams',
    description: 'Issue and invalidate student examination cards',
  },

  {
    key: PERMISSIONS.CLEARANCE_VIEW,
    category: 'clearance',
    description: 'View clearance units, requests and steps',
  },
  {
    key: PERMISSIONS.CLEARANCE_SIGN,
    category: 'clearance',
    description: 'Sign a clearance step for a unit (clear/block)',
  },
  {
    key: PERMISSIONS.CLEARANCE_WAIVE,
    category: 'clearance',
    description: 'Waive a mandatory clearance step (requires a distinct authoriser)',
  },
  {
    key: PERMISSIONS.GRADUATION_VIEW,
    category: 'graduation',
    description: 'View graduation candidates, Senate approvals and graduation lists',
  },
  {
    key: PERMISSIONS.GRADUATION_EVALUATE,
    category: 'graduation',
    description: 'Run graduation evaluations for students in scope',
  },
  {
    key: PERMISSIONS.GRADUATION_APPROVE,
    category: 'graduation',
    description: 'Record Senate approvals and finalise graduation lists',
  },

  {
    key: PERMISSIONS.TRANSCRIPTS_VIEW,
    category: 'transcripts',
    description: 'View transcript and document requests in scope',
  },
  {
    key: PERMISSIONS.TRANSCRIPTS_REVIEW,
    category: 'transcripts',
    description: 'Review, approve, generate and dispatch transcript requests',
  },

  {
    key: PERMISSIONS.STUDENTS_VIEW,
    category: 'students',
    description: 'View student master records',
  },
  {
    key: PERMISSIONS.STUDENTS_CREATE,
    category: 'students',
    description: 'Create official student records',
  },
  {
    key: PERMISSIONS.STUDENTS_UPDATE,
    category: 'students',
    description: 'Update non-protected student fields',
  },
  {
    key: PERMISSIONS.STUDENTS_IMPORT,
    category: 'students',
    description: 'Bulk import student records',
  },
  {
    key: PERMISSIONS.STUDENTS_ACTIVATE,
    category: 'students',
    description: 'Administratively manage activation state',
  },
  {
    key: PERMISSIONS.STUDENTS_STATUS,
    category: 'students',
    description: 'Change a student academic status',
  },
  {
    key: PERMISSIONS.STUDENTS_AMEND,
    category: 'students',
    description: 'Approve protected-field amendments',
  },

  {
    key: PERMISSIONS.CHANGE_REQUESTS_VIEW,
    category: 'change_requests',
    description: 'View profile change requests',
  },
  {
    key: PERMISSIONS.CHANGE_REQUESTS_REVIEW,
    category: 'change_requests',
    description: 'Approve/reject change requests',
  },

  { key: PERMISSIONS.AUDIT_VIEW, category: 'audit', description: 'View the audit log' },

  {
    key: PERMISSIONS.DASHBOARD_ADMIN_VIEW,
    category: 'dashboard',
    description: 'View the administrative dashboard',
  },
  {
    key: PERMISSIONS.DASHBOARD_LECTURER_VIEW,
    category: 'dashboard',
    description: 'View the lecturer dashboard (allocated teaching, score entry status)',
  },
  {
    key: PERMISSIONS.DASHBOARD_ADVISER_VIEW,
    category: 'dashboard',
    description: 'View the academic adviser dashboard (advisees, registrations in scope)',
  },
  {
    key: PERMISSIONS.DASHBOARD_BURSAR_VIEW,
    category: 'dashboard',
    description: 'View the bursary dashboard (revenue, outstanding fees, waivers)',
  },
  {
    key: PERMISSIONS.DASHBOARD_HOD_VIEW,
    category: 'dashboard',
    description: 'View the department dashboard (department statistics and approvals)',
  },
  {
    key: PERMISSIONS.DASHBOARD_FACULTY_VIEW,
    category: 'dashboard',
    description: 'View the faculty dashboard (faculty statistics and approvals)',
  },
  {
    key: PERMISSIONS.DASHBOARD_REGISTRY_VIEW,
    category: 'dashboard',
    description: 'View the registry dashboard (records, change requests, credentials)',
  },
  {
    key: PERMISSIONS.DASHBOARD_ADMISSIONS_VIEW,
    category: 'dashboard',
    description: 'View the admissions dashboard (applications, offers, intake)',
  },
  {
    key: PERMISSIONS.DASHBOARD_EXAMS_VIEW,
    category: 'dashboard',
    description: 'View the examinations dashboard (periods, schedules, cards, attendance)',
  },
  {
    key: PERMISSIONS.DASHBOARD_LIBRARY_VIEW,
    category: 'dashboard',
    description: 'View the library dashboard (library clearance steps)',
  },
  {
    key: PERMISSIONS.DASHBOARD_AFFAIRS_VIEW,
    category: 'dashboard',
    description: 'View the student affairs dashboard (affairs clearance, misconduct, holds)',
  },
  {
    key: PERMISSIONS.DASHBOARD_HOSTEL_VIEW,
    category: 'dashboard',
    description: 'View the accommodation dashboard (hostel clearance steps)',
  },
  {
    key: PERMISSIONS.DASHBOARD_PROJECT_VIEW,
    category: 'dashboard',
    description: 'View the project/SIWES coordinator dashboard (supervision, results pipeline)',
  },
  {
    key: PERMISSIONS.DASHBOARD_REGISTRAR_VIEW,
    category: 'dashboard',
    description: 'View the university-wide registrar dashboard',
  },
  {
    key: PERMISSIONS.DASHBOARD_VC_VIEW,
    category: 'dashboard',
    description: 'View the executive overview dashboard',
  },
];
