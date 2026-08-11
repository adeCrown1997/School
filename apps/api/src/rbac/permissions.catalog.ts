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
];
