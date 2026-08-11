import { UserType } from '@prisma/client';

/**
 * The principal attached to a request after JWT verification. `permissions` is
 * the flattened set of permission keys the user holds across ALL their role
 * assignments; `scopes` preserves the (permission → scope) detail for
 * ABAC-style checks (e.g. an HOD may only act within their department).
 *
 * This object is derived server-side from the DB on each request — it is NOT
 * taken from client input, and the access token carries only the userId +
 * a permissions snapshot used for fast checks; sensitive authority decisions
 * re-read the DB where correctness matters.
 */
export interface AuthScope {
  scopeType: 'GLOBAL' | 'FACULTY' | 'DEPARTMENT' | 'PROGRAMME';
  facultyId?: string | null;
  departmentId?: string | null;
  programmeId?: string | null;
}

export interface AuthPrincipal {
  userId: string;
  userType: UserType;
  email: string;
  fullName: string;
  /** Flattened permission keys, e.g. ["students.view", "students.create"]. */
  permissions: string[];
  /** Per-assignment detail: permission key → scopes it was granted within. */
  scopedPermissions: Array<{ permission: string; scope: AuthScope }>;
  /** Linked student record id, present only for activated student accounts. */
  studentRecordId?: string | null;
  /**
   * The student's matriculation number — their login identifier. Read-only here:
   * it is sourced from the master record on every request, never from the token,
   * and no route lets a student write it.
   */
  matriculationNumber?: string | null;
  /**
   * True while the account still holds the initial password issued at
   * activation. Resolved from the DB on every request (not from the token), so
   * clearing it takes effect immediately rather than at token expiry.
   */
  mustChangePassword: boolean;
}

/** Shape of the signed JWT access-token payload. */
export interface AccessTokenPayload {
  sub: string; // userId
  typ: UserType;
  perms: string[];
  srid?: string | null; // studentRecordId
}
