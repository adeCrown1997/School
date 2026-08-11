import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuthPrincipal, AuthScope } from '../common/auth-principal';

/**
 * Central RBAC resolution. Two responsibilities:
 *  1. resolvePrincipal — turn a userId into the live AuthPrincipal (permissions
 *     flattened from all role assignments). Returns null if the user is absent
 *     or deactivated, so guards fail closed.
 *  2. getEffectivePermissions / assertCanGrantRole — grant-authority: an
 *     administrator may only assign a role whose permissions are a SUBSET of
 *     the permissions they themselves hold. This prevents privilege escalation
 *     via role assignment.
 */
@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  async resolvePrincipal(userId: string): Promise<AuthPrincipal | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        roleAssignments: {
          include: {
            role: {
              include: {
                rolePermissions: { include: { permission: true } },
              },
            },
          },
        },
        // Student portal: the principal needs the master record's matriculation
        // number (the student's login id) and the live mustChangePassword flag,
        // neither of which is trusted to sit in a token.
        studentRecord: { select: { matriculationNumber: true } },
      },
    });
    if (!user || !user.isActive) return null;

    const scopedPermissions: Array<{ permission: string; scope: AuthScope }> = [];
    const permissionSet = new Set<string>();

    for (const ra of user.roleAssignments) {
      const scope: AuthScope = {
        scopeType: ra.scopeType,
        facultyId: ra.facultyId,
        departmentId: ra.departmentId,
        programmeId: ra.programmeId,
      };
      for (const rp of ra.role.rolePermissions) {
        permissionSet.add(rp.permission.key);
        scopedPermissions.push({ permission: rp.permission.key, scope });
      }
    }

    return {
      userId: user.id,
      userType: user.userType,
      email: user.email,
      fullName: user.fullName,
      permissions: [...permissionSet],
      scopedPermissions,
      studentRecordId: user.studentRecordId,
      matriculationNumber: user.studentRecord?.matriculationNumber ?? null,
      mustChangePassword: user.mustChangePassword,
    };
  }

  /** Flattened permission keys currently held by a user (for grant-authority). */
  async getEffectivePermissions(userId: string): Promise<Set<string>> {
    const principal = await this.resolvePrincipal(userId);
    return new Set(principal?.permissions ?? []);
  }

  /**
   * Grant-authority guard. The actor may assign `roleId` only if every
   * permission in that role is contained in the actor's own effective
   * permissions. Throws nothing; returns the list of permissions the actor is
   * MISSING (empty array = allowed).
   */
  async permissionsActorCannotGrant(actorId: string, roleId: string): Promise<string[]> {
    const [actorPerms, role] = await Promise.all([
      this.getEffectivePermissions(actorId),
      this.prisma.role.findUnique({
        where: { id: roleId },
        include: { rolePermissions: { include: { permission: true } } },
      }),
    ]);
    if (!role) return ['__ROLE_NOT_FOUND__'];
    const rolePerms = role.rolePermissions.map((rp) => rp.permission.key);
    return rolePerms.filter((p) => !actorPerms.has(p));
  }
}
