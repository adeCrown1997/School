/**
 * CLIENT-SIDE MIRROR of the API permission catalog
 * (apps/api/src/rbac/permissions.catalog.ts).
 *
 * These keys are used ONLY to decide what to render — which nav links to show,
 * which buttons to enable. They are NOT a security boundary: the API guards
 * every endpoint independently and will reject an unauthorized call regardless
 * of what the UI shows. Keeping this list in sync with the server is a UX nicety,
 * never a control. (See lib/api.ts for the same note.)
 */
export const PERMISSIONS = {
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DEACTIVATE: 'users.deactivate',
  USERS_RESET: 'users.reset',

  ROLES_VIEW: 'roles.view',
  ROLES_CREATE: 'roles.create',
  ROLES_UPDATE: 'roles.update',
  ROLES_ASSIGN: 'roles.assign',
  PERMISSIONS_VIEW: 'permissions.view',

  STRUCTURE_VIEW: 'structure.view',
  STRUCTURE_MANAGE: 'structure.manage',

  COURSES_VIEW: 'courses.view',
  COURSES_CREATE: 'courses.create',
  COURSES_UPDATE: 'courses.update',
  COURSES_DEACTIVATE: 'courses.deactivate',

  CURRICULUM_VIEW: 'curriculum.view',
  CURRICULUM_MANAGE: 'curriculum.manage',
  CURRICULUM_PUBLISH: 'curriculum.publish',

  OFFERINGS_VIEW: 'offerings.view',
  OFFERINGS_MANAGE: 'offerings.manage',

  ACADEMIC_CONFIG_VIEW: 'academic.config.view',
  ACADEMIC_CONFIG_MANAGE: 'academic.config.manage',

  STUDENTS_VIEW: 'students.view',
  STUDENTS_CREATE: 'students.create',
  STUDENTS_UPDATE: 'students.update',
  STUDENTS_IMPORT: 'students.import',
  STUDENTS_ACTIVATE: 'students.activate',
  STUDENTS_STATUS: 'students.status',
  STUDENTS_AMEND: 'students.amend',

  CHANGE_REQUESTS_VIEW: 'change_requests.view',
  CHANGE_REQUESTS_REVIEW: 'change_requests.review',

  REGISTRATION_VIEW: 'registration.view',
  REGISTRATION_MANAGE: 'registration.manage',
  REGISTRATION_APPROVE: 'registration.approve',
  REGISTRATION_LOCK: 'registration.lock',
  REGISTRATION_EXCEPTION_REVIEW: 'registration.exception.review',

  // Results (Phase 3). The six-key split IS the separation of duties on
  // screen: the lecturer who enters scores cannot also approve or publish
  // them — the buttons simply do not render, and the API enforces it anyway.
  RESULTS_VIEW: 'results.view',
  RESULTS_ASSESS_MANAGE: 'results.assess.manage',
  RESULTS_SCORE_MANAGE: 'results.score.manage',
  RESULTS_APPROVE: 'results.approve',
  RESULTS_PUBLISH: 'results.publish',
  RESULTS_WITHHOLD: 'results.withhold',

  // Finance (Phase 4). Split mirrors the SOD pairs of docs/02 §5.4 — the
  // officer who raises an invoice is not the one who waives it.
  FINANCE_VIEW: 'finance.view',
  FINANCE_SCHEDULE_MANAGE: 'finance.schedule.manage',
  FINANCE_INVOICE_MANAGE: 'finance.invoice.manage',
  FINANCE_PAYMENT_MANAGE: 'finance.payment.manage',
  FINANCE_WAIVER_MANAGE: 'finance.waiver.manage',
  FINANCE_RECONCILE: 'finance.reconcile',

  AUDIT_VIEW: 'audit.view',

  DASHBOARD_ADMIN_VIEW: 'dashboard.admin.view',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** True if `held` contains `perm`. A missing/empty set means "no permission". */
export function can(held: readonly string[] | undefined, perm: PermissionKey): boolean {
  return !!held && held.includes(perm);
}

/** True if `held` contains at least one of `perms`. */
export function canAny(held: readonly string[] | undefined, perms: PermissionKey[]): boolean {
  return !!held && perms.some((p) => held.includes(p));
}
