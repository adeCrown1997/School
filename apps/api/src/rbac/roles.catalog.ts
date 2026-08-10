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
      P.AUDIT_VIEW,
      P.DASHBOARD_ADMIN_VIEW,
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
    ],
  },
  {
    key: 'FACULTY_OFFICER',
    name: 'Faculty Officer',
    description: 'Views students and academic structure within their faculty scope.',
    scopeKind: ScopeType.FACULTY,
    permissions: [...STUDENT_READONLY, ...ACADEMIC_READONLY, P.DASHBOARD_ADMIN_VIEW],
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
      P.DASHBOARD_ADMIN_VIEW,
    ],
  },
  {
    key: 'ACADEMIC_ADVISER',
    name: 'Academic Adviser',
    description: 'Views advisees and academic structure within their department/programme scope.',
    scopeKind: ScopeType.DEPARTMENT,
    permissions: [...STUDENT_READONLY, ...ACADEMIC_READONLY],
  },
  {
    key: 'LECTURER',
    name: 'Lecturer',
    description:
      'Teaching staff. Read-only structure and course catalogue; academic modules arrive later.',
    scopeKind: ScopeType.DEPARTMENT,
    permissions: [P.STRUCTURE_VIEW, ...ACADEMIC_READONLY],
  },
  {
    key: 'BURSARY_OFFICER',
    name: 'Bursary Officer',
    description:
      'Finance staff. Phase 1: read-only student directory; finance modules arrive later.',
    scopeKind: ScopeType.GLOBAL,
    permissions: [...STUDENT_READONLY],
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
    // student enumerate every student's change requests.
    permissions: [],
  },
];

/** Roles that are seeded as system roles (immutable key/name, undeletable). */
export const SYSTEM_ROLE_KEYS = ROLE_DEFS.map((r) => r.key);
