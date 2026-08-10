import { ForbiddenException } from '@nestjs/common';
import { AuthPrincipal, AuthScope } from '../common/auth-principal';
import { PERMISSIONS } from './permissions.catalog';
import {
  assertDepartmentWithinScope,
  assertWithinScope,
  scopeConstraintFor,
  studentScopeWhere,
} from './scope.util';

/**
 * Scope resolution is the ABAC half of authorization: it decides which records a
 * principal may read/write given the scopes their permissions were granted at.
 * Getting this wrong is a horizontal-privilege escalation, so it is tested
 * exhaustively — including the fail-closed cases.
 */

function principal(
  scopedPermissions: Array<{ permission: string; scope: AuthScope }>,
): AuthPrincipal {
  return {
    userId: 'u1',
    userType: 'STAFF',
    email: 'officer@uni.example',
    fullName: 'Officer',
    permissions: [...new Set(scopedPermissions.map((s) => s.permission))],
    scopedPermissions,
  };
}

const VIEW = PERMISSIONS.STUDENTS_VIEW;

describe('scope.util', () => {
  describe('scopeConstraintFor', () => {
    it('marks GLOBAL grants as unrestricted', () => {
      const c = scopeConstraintFor(
        principal([{ permission: VIEW, scope: { scopeType: 'GLOBAL' } }]),
        VIEW,
      );
      expect(c.unrestricted).toBe(true);
      expect(c.facultyIds).toEqual([]);
    });

    it('collects scoped ids per level and de-duplicates them', () => {
      const c = scopeConstraintFor(
        principal([
          { permission: VIEW, scope: { scopeType: 'FACULTY', facultyId: 'f1' } },
          { permission: VIEW, scope: { scopeType: 'FACULTY', facultyId: 'f1' } },
          { permission: VIEW, scope: { scopeType: 'DEPARTMENT', departmentId: 'd1' } },
          { permission: VIEW, scope: { scopeType: 'PROGRAMME', programmeId: 'p1' } },
        ]),
        VIEW,
      );
      expect(c.unrestricted).toBe(false);
      expect(c.facultyIds).toEqual(['f1']);
      expect(c.departmentIds).toEqual(['d1']);
      expect(c.programmeIds).toEqual(['p1']);
    });

    it('ignores grants for a DIFFERENT permission', () => {
      const c = scopeConstraintFor(
        principal([{ permission: PERMISSIONS.STUDENTS_CREATE, scope: { scopeType: 'GLOBAL' } }]),
        VIEW,
      );
      expect(c.unrestricted).toBe(false);
      expect(c.facultyIds).toEqual([]);
    });

    it('drops scoped grants missing their id (fails closed, not wide)', () => {
      const c = scopeConstraintFor(
        principal([{ permission: VIEW, scope: { scopeType: 'FACULTY', facultyId: null } }]),
        VIEW,
      );
      expect(c.unrestricted).toBe(false);
      expect(c.facultyIds).toEqual([]);
    });
  });

  describe('studentScopeWhere', () => {
    it('returns undefined (no filter) when unrestricted', () => {
      expect(
        studentScopeWhere({
          unrestricted: true,
          facultyIds: [],
          departmentIds: [],
          programmeIds: [],
        }),
      ).toBeUndefined();
    });

    it('builds an OR of the scoped ids', () => {
      expect(
        studentScopeWhere({
          unrestricted: false,
          facultyIds: ['f1'],
          departmentIds: ['d1'],
          programmeIds: [],
        }),
      ).toEqual({
        OR: [{ facultyId: { in: ['f1'] } }, { departmentId: { in: ['d1'] } }],
      });
    });

    it('returns an impossible-match filter when scoped but with NO usable ids', () => {
      // Holds the permission but at no concrete scope → must see nothing.
      const where = studentScopeWhere({
        unrestricted: false,
        facultyIds: [],
        departmentIds: [],
        programmeIds: [],
      });
      expect(where).toEqual({ id: '00000000-0000-0000-0000-000000000000' });
    });
  });

  describe('assertWithinScope', () => {
    const target = { facultyId: 'f1', departmentId: 'd1', programmeId: 'p1' };

    it('permits any record when unrestricted', () => {
      expect(() =>
        assertWithinScope(
          { unrestricted: true, facultyIds: [], departmentIds: [], programmeIds: [] },
          target,
        ),
      ).not.toThrow();
    });

    it('permits a record whose faculty is in scope', () => {
      expect(() =>
        assertWithinScope(
          { unrestricted: false, facultyIds: ['f1'], departmentIds: [], programmeIds: [] },
          target,
        ),
      ).not.toThrow();
    });

    it('permits a record matched at the department or programme level', () => {
      expect(() =>
        assertWithinScope(
          { unrestricted: false, facultyIds: [], departmentIds: ['d1'], programmeIds: [] },
          target,
        ),
      ).not.toThrow();
      expect(() =>
        assertWithinScope(
          { unrestricted: false, facultyIds: [], departmentIds: [], programmeIds: ['p1'] },
          target,
        ),
      ).not.toThrow();
    });

    it('throws ForbiddenException for an out-of-scope record', () => {
      expect(() =>
        assertWithinScope(
          { unrestricted: false, facultyIds: ['other'], departmentIds: [], programmeIds: [] },
          target,
        ),
      ).toThrow(ForbiddenException);
    });

    it('throws for a scoped principal with no ids at all (fail closed)', () => {
      expect(() =>
        assertWithinScope(
          { unrestricted: false, facultyIds: [], departmentIds: [], programmeIds: [] },
          target,
        ),
      ).toThrow(ForbiddenException);
    });
  });

  /**
   * Phase 2 authoring authority. A catalogue course / course offering is owned by
   * a DEPARTMENT (or by nobody, for university-wide General Studies), so its
   * scope check cannot reuse the student-record triple. The escalation risks
   * proven closed here are the two asymmetries the helper documents.
   */
  describe('assertDepartmentWithinScope', () => {
    const owned = { departmentId: 'd1', facultyId: 'f1' };
    const universityWide = { departmentId: null, facultyId: null };

    it('permits anything when unrestricted (GLOBAL grant)', () => {
      expect(() =>
        assertDepartmentWithinScope(
          { unrestricted: true, facultyIds: [], departmentIds: [], programmeIds: [] },
          owned,
        ),
      ).not.toThrow();
    });

    it('permits the owning department (the HOD case)', () => {
      expect(() =>
        assertDepartmentWithinScope(
          { unrestricted: false, facultyIds: [], departmentIds: ['d1'], programmeIds: [] },
          owned,
        ),
      ).not.toThrow();
    });

    it('permits a department inside the actor’s faculty', () => {
      expect(() =>
        assertDepartmentWithinScope(
          { unrestricted: false, facultyIds: ['f1'], departmentIds: [], programmeIds: [] },
          owned,
        ),
      ).not.toThrow();
    });

    it('refuses another department', () => {
      expect(() =>
        assertDepartmentWithinScope(
          { unrestricted: false, facultyIds: [], departmentIds: ['other'], programmeIds: [] },
          owned,
        ),
      ).toThrow(ForbiddenException);
    });

    it('refuses a PROGRAMME-scoped actor even inside the owning department', () => {
      // A course is shared by every programme in its department, so authority
      // over one programme must not confer authority over the course.
      expect(() =>
        assertDepartmentWithinScope(
          { unrestricted: false, facultyIds: [], departmentIds: [], programmeIds: ['p1'] },
          owned,
        ),
      ).toThrow(ForbiddenException);
    });

    it('reserves university-wide records for GLOBAL authority', () => {
      expect(() =>
        assertDepartmentWithinScope(
          { unrestricted: false, facultyIds: ['f1'], departmentIds: ['d1'], programmeIds: [] },
          universityWide,
        ),
      ).toThrow(/global scope/);
      expect(() =>
        assertDepartmentWithinScope(
          { unrestricted: true, facultyIds: [], departmentIds: [], programmeIds: [] },
          universityWide,
        ),
      ).not.toThrow();
    });

    it('throws for a scoped principal with no ids at all (fail closed)', () => {
      expect(() =>
        assertDepartmentWithinScope(
          { unrestricted: false, facultyIds: [], departmentIds: [], programmeIds: [] },
          owned,
        ),
      ).toThrow(ForbiddenException);
    });
  });
});
