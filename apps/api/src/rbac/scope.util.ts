import { ForbiddenException } from '@nestjs/common';
import { AuthPrincipal } from '../common/auth-principal';
import { PermissionKey } from './permissions.catalog';

/**
 * Translates a principal's SCOPED permissions into a concrete authority set for
 * student records. A user may hold the same permission (e.g. students.view) at
 * several scopes: GLOBAL (everything), or a specific FACULTY / DEPARTMENT /
 * PROGRAMME. This collapses those grants into either "unrestricted" or the
 * union of ids the user is confined to.
 *
 * Used for BOTH read visibility (which records a list returns) and write
 * authority (whether a create/amend targets a record the actor may touch), so
 * scope is enforced on the backend for every path — not by hiding UI.
 */
export interface ScopeConstraint {
  unrestricted: boolean;
  facultyIds: string[];
  departmentIds: string[];
  programmeIds: string[];
}

/** Build the authority set the principal has for a given permission. */
export function scopeConstraintFor(
  principal: AuthPrincipal,
  permission: PermissionKey,
): ScopeConstraint {
  const facultyIds = new Set<string>();
  const departmentIds = new Set<string>();
  const programmeIds = new Set<string>();
  let unrestricted = false;

  for (const sp of principal.scopedPermissions) {
    if (sp.permission !== permission) continue;
    const s = sp.scope;
    switch (s.scopeType) {
      case 'GLOBAL':
        unrestricted = true;
        break;
      case 'FACULTY':
        if (s.facultyId) facultyIds.add(s.facultyId);
        break;
      case 'DEPARTMENT':
        if (s.departmentId) departmentIds.add(s.departmentId);
        break;
      case 'PROGRAMME':
        if (s.programmeId) programmeIds.add(s.programmeId);
        break;
    }
  }

  return {
    unrestricted,
    facultyIds: [...facultyIds],
    departmentIds: [...departmentIds],
    programmeIds: [...programmeIds],
  };
}

/**
 * A Prisma `where` fragment (for StudentRecord) that limits results to the
 * scope. Returns `undefined` when unrestricted (no filter), or a disjunction of
 * the scoped ids. If the user holds the permission but at NO usable scope, the
 * filter is impossible-to-match ({ id: null-ish }) so they see nothing — fail
 * closed rather than open.
 */
export function studentScopeWhere(
  constraint: ScopeConstraint,
): Record<string, unknown> | undefined {
  if (constraint.unrestricted) return undefined;

  const or: Array<Record<string, unknown>> = [];
  if (constraint.facultyIds.length) or.push({ facultyId: { in: constraint.facultyIds } });
  if (constraint.departmentIds.length) or.push({ departmentId: { in: constraint.departmentIds } });
  if (constraint.programmeIds.length) or.push({ programmeId: { in: constraint.programmeIds } });

  if (or.length === 0) {
    // Holds the permission but with no concrete scope → match nothing.
    return { id: '00000000-0000-0000-0000-000000000000' };
  }
  return { OR: or };
}

/**
 * Assert the actor's scope authorizes acting on a record located at the given
 * (faculty, department, programme). Throws ForbiddenException otherwise. A
 * record is in scope if the actor is unrestricted, or the record's faculty /
 * department / programme is among the actor's scoped ids.
 */
export function assertWithinScope(
  constraint: ScopeConstraint,
  target: { facultyId: string; departmentId: string; programmeId: string },
): void {
  if (constraint.unrestricted) return;
  const inScope =
    constraint.facultyIds.includes(target.facultyId) ||
    constraint.departmentIds.includes(target.departmentId) ||
    constraint.programmeIds.includes(target.programmeId);
  if (!inScope) {
    throw new ForbiddenException('This record is outside your assigned scope');
  }
}

/**
 * Where a DEPARTMENT-OWNED academic resource sits — a catalogue course or a
 * course offering. Unlike a student record (always at a definite faculty +
 * department + programme), these may be UNIVERSITY-WIDE: a General Studies
 * course belongs to no department, so both ids are null. `facultyId` is the
 * owning department's faculty, resolved by the caller.
 */
export interface DepartmentLocation {
  departmentId: string | null;
  facultyId: string | null;
}

/**
 * Assert the actor may WRITE a department-owned academic record (Phase 2:
 * courses, offerings). This is the authority check behind scope-aware authoring
 * — e.g. an HOD granted courses.create at DEPARTMENT scope may author courses
 * for their own department and nothing else.
 *
 * Two deliberate asymmetries with `assertWithinScope`:
 *
 *   • A university-wide record (departmentId null) requires GLOBAL authority. No
 *     single department or faculty owns General Studies, so a department- or
 *     faculty-scoped actor must not be able to redefine it.
 *   • PROGRAMME-scoped grants confer NOTHING here. A course is owned by a
 *     department and shared across every programme in it, so authority over one
 *     programme is strictly narrower than authority over the course. Widening it
 *     would let a programme-scoped actor edit courses other programmes depend
 *     on. Fail closed.
 */
export function assertDepartmentWithinScope(
  constraint: ScopeConstraint,
  target: DepartmentLocation,
): void {
  if (constraint.unrestricted) return;
  const inScope =
    (target.departmentId !== null && constraint.departmentIds.includes(target.departmentId)) ||
    (target.facultyId !== null && constraint.facultyIds.includes(target.facultyId));
  if (!inScope) {
    throw new ForbiddenException(
      target.departmentId === null
        ? 'University-wide academic records may only be managed at global scope'
        : 'This record is outside your assigned scope',
    );
  }
}
