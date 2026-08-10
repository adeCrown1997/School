import { RbacService } from './rbac.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * RbacService owns two safety-critical decisions:
 *  • resolvePrincipal must FAIL CLOSED (return null) for an absent or deactivated
 *    user, so a disabled account cannot pass the auth guards.
 *  • permissionsActorCannotGrant is the grant-authority guard that prevents an
 *    admin assigning a role carrying a permission they do not themselves hold
 *    (privilege escalation). It returns the set of permissions the actor LACKS.
 */
function makeService(prisma: Partial<PrismaService>): RbacService {
  return new RbacService(prisma as PrismaService);
}

const roleAssignment = (scopeType: string, perms: string[], ids: Record<string, string> = {}) => ({
  scopeType,
  facultyId: ids.facultyId ?? null,
  departmentId: ids.departmentId ?? null,
  programmeId: ids.programmeId ?? null,
  role: {
    rolePermissions: perms.map((key) => ({ permission: { key } })),
  },
});

describe('RbacService', () => {
  describe('resolvePrincipal', () => {
    it('returns null when the user does not exist (fail closed)', async () => {
      const svc = makeService({
        user: { findUnique: jest.fn().mockResolvedValue(null) } as never,
      });
      expect(await svc.resolvePrincipal('missing')).toBeNull();
    });

    it('returns null for a deactivated user (fail closed)', async () => {
      const svc = makeService({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1',
            isActive: false,
            roleAssignments: [],
          }),
        } as never,
      });
      expect(await svc.resolvePrincipal('u1')).toBeNull();
    });

    it('flattens permissions across assignments and preserves per-scope detail', async () => {
      const svc = makeService({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'u1',
            userType: 'STAFF',
            email: 'o@uni.example',
            fullName: 'Officer',
            isActive: true,
            studentRecordId: null,
            roleAssignments: [
              roleAssignment('GLOBAL', ['students.view', 'students.create']),
              roleAssignment('FACULTY', ['students.view'], { facultyId: 'f1' }),
            ],
          }),
        } as never,
      });

      const principal = await svc.resolvePrincipal('u1');
      expect(principal).not.toBeNull();
      expect(new Set(principal!.permissions)).toEqual(
        new Set(['students.view', 'students.create']),
      );
      // Scoped detail keeps BOTH grants of students.view (global + faculty).
      const viewScopes = principal!.scopedPermissions.filter(
        (s) => s.permission === 'students.view',
      );
      expect(viewScopes).toHaveLength(2);
      expect(viewScopes.map((s) => s.scope.scopeType).sort()).toEqual(['FACULTY', 'GLOBAL']);
    });
  });

  describe('permissionsActorCannotGrant', () => {
    it('returns an empty list when the actor holds every permission in the role (allowed)', async () => {
      const svc = makeService({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'actor',
            isActive: true,
            roleAssignments: [
              roleAssignment('GLOBAL', ['students.view', 'students.create', 'audit.view']),
            ],
          }),
        } as never,
        role: {
          findUnique: jest.fn().mockResolvedValue({
            rolePermissions: [
              { permission: { key: 'students.view' } },
              { permission: { key: 'students.create' } },
            ],
          }),
        } as never,
      });

      expect(await svc.permissionsActorCannotGrant('actor', 'role1')).toEqual([]);
    });

    it('returns the missing permissions when the actor cannot grant them all (blocked)', async () => {
      const svc = makeService({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'actor',
            isActive: true,
            roleAssignments: [roleAssignment('GLOBAL', ['students.view'])],
          }),
        } as never,
        role: {
          findUnique: jest.fn().mockResolvedValue({
            rolePermissions: [
              { permission: { key: 'students.view' } },
              { permission: { key: 'roles.assign' } }, // actor lacks this
            ],
          }),
        } as never,
      });

      expect(await svc.permissionsActorCannotGrant('actor', 'role1')).toEqual(['roles.assign']);
    });

    it('reports a sentinel when the target role does not exist', async () => {
      const svc = makeService({
        user: {
          findUnique: jest.fn().mockResolvedValue({
            id: 'actor',
            isActive: true,
            roleAssignments: [],
          }),
        } as never,
        role: { findUnique: jest.fn().mockResolvedValue(null) } as never,
      });

      expect(await svc.permissionsActorCannotGrant('actor', 'ghost')).toEqual([
        '__ROLE_NOT_FOUND__',
      ]);
    });

    it('a deactivated actor (no effective permissions) cannot grant anything', async () => {
      const svc = makeService({
        user: {
          findUnique: jest.fn().mockResolvedValue({ id: 'actor', isActive: false }),
        } as never,
        role: {
          findUnique: jest.fn().mockResolvedValue({
            rolePermissions: [{ permission: { key: 'students.view' } }],
          }),
        } as never,
      });

      expect(await svc.permissionsActorCannotGrant('actor', 'role1')).toEqual(['students.view']);
    });
  });
});
