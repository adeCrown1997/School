import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import {
  dashboardScopeFor,
  idFilterOrNone,
  NO_MATCHING_ID,
  offeringDepartmentWhere,
} from './dashboards.scope';

/**
 * Dashboard scoping is the authorization core of the role dashboards: every
 * student-located figure must stay inside the actor's scope for the underlying
 * module permission. These tests pin the fail-closed behaviour — a permission
 * held at no usable scope matches NOTHING, never everything.
 */
function principal(
  scopes: Array<{ permission: string; scope: AuthPrincipal['scopedPermissions'][number]['scope'] }>,
): AuthPrincipal {
  return {
    userId: 'u1',
    userType: 'STAFF',
    email: 'a@b.c',
    fullName: 'A',
    permissions: [PERMISSIONS.STUDENTS_VIEW],
    scopedPermissions: scopes.map((s) => ({ permission: s.permission, scope: s.scope })),
    mustChangePassword: false,
  };
}

describe('dashboardScopeFor', () => {
  it('is unrestricted for a GLOBAL grant', () => {
    const scope = dashboardScopeFor(
      principal([{ permission: PERMISSIONS.STUDENTS_VIEW, scope: { scopeType: 'GLOBAL' } }]),
      PERMISSIONS.STUDENTS_VIEW,
    );
    expect(scope.unrestricted).toBe(true);
    expect(scope.studentWhere).toEqual({});
    expect(scope.summary.unrestricted).toBe(true);
  });

  it('confines a DEPARTMENT grant to that department', () => {
    const scope = dashboardScopeFor(
      principal([
        {
          permission: PERMISSIONS.STUDENTS_VIEW,
          scope: { scopeType: 'DEPARTMENT', departmentId: 'd1' },
        },
      ]),
      PERMISSIONS.STUDENTS_VIEW,
    );
    expect(scope.unrestricted).toBe(false);
    expect(scope.studentWhere).toEqual({ OR: [{ departmentId: { in: ['d1'] } }] });
    expect(scope.summary.departmentIds).toEqual(['d1']);
  });

  it('unions several scoped grants of the same permission', () => {
    const scope = dashboardScopeFor(
      principal([
        { permission: PERMISSIONS.STUDENTS_VIEW, scope: { scopeType: 'FACULTY', facultyId: 'f1' } },
        {
          permission: PERMISSIONS.STUDENTS_VIEW,
          scope: { scopeType: 'DEPARTMENT', departmentId: 'd2' },
        },
        {
          permission: PERMISSIONS.STUDENTS_VIEW,
          scope: { scopeType: 'PROGRAMME', programmeId: 'p3' },
        },
      ]),
      PERMISSIONS.STUDENTS_VIEW,
    );
    expect(scope.unrestricted).toBe(false);
    expect(scope.studentWhere).toEqual({
      OR: [
        { facultyId: { in: ['f1'] } },
        { departmentId: { in: ['d2'] } },
        { programmeId: { in: ['p3'] } },
      ],
    });
  });

  it('FAILS CLOSED: a permission held at no usable scope matches nothing', () => {
    // No grant of the permission at any scope → the filter must be impossible
    // to satisfy, so a holder of the permission alone (no scope rows) sees
    // nothing — never everything.
    const none = dashboardScopeFor(principal([] as never[]), PERMISSIONS.STUDENTS_VIEW);
    expect(none.unrestricted).toBe(false);
    expect(none.studentWhere).toEqual({ id: NO_MATCHING_ID });
  });
});

describe('offeringDepartmentWhere', () => {
  it('returns no filter for an unrestricted actor', () => {
    const scope = dashboardScopeFor(
      principal([{ permission: PERMISSIONS.COURSES_VIEW, scope: { scopeType: 'GLOBAL' } }]),
      PERMISSIONS.COURSES_VIEW,
    );
    expect(offeringDepartmentWhere(scope)).toEqual({});
  });

  it('maps a department scope to the offerings of that department', () => {
    const scope = dashboardScopeFor(
      principal([
        {
          permission: PERMISSIONS.COURSES_VIEW,
          scope: { scopeType: 'DEPARTMENT', departmentId: 'd1' },
        },
      ]),
      PERMISSIONS.COURSES_VIEW,
    );
    expect(offeringDepartmentWhere(scope)).toEqual({
      OR: [{ departmentId: { in: ['d1'] } }],
    });
  });

  it('FAILS CLOSED with an impossible id when the scope carries no usable ids', () => {
    const scope = dashboardScopeFor(principal([] as never[]), PERMISSIONS.COURSES_VIEW);
    expect(offeringDepartmentWhere(scope)).toEqual({ id: NO_MATCHING_ID });
  });

  it('maps a faculty scope through the owning faculty', () => {
    const scope = dashboardScopeFor(
      principal([
        { permission: PERMISSIONS.COURSES_VIEW, scope: { scopeType: 'FACULTY', facultyId: 'f1' } },
      ]),
      PERMISSIONS.COURSES_VIEW,
    );
    expect(offeringDepartmentWhere(scope)).toEqual({
      OR: [{ department: { facultyId: { in: ['f1'] } } }],
    });
  });
});

describe('idFilterOrNone', () => {
  it('selects a non-empty list', () => {
    expect(idFilterOrNone(['a', 'b'])).toEqual({ in: ['a', 'b'] });
  });

  it('matches nothing for an empty list (fail closed)', () => {
    expect(idFilterOrNone([])).toBe(NO_MATCHING_ID);
  });
});
