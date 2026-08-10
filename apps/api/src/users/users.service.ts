import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, Role, RoleAssignment, ScopeType, User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from '../auth/password.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { AuthPrincipal } from '../common/auth-principal';
import { RequestContext } from '../auth/auth.service';
import { generateToken, sha256 } from '../common/crypto.util';
import { sortDirection } from '../common/pagination';
import {
  AssignRoleDto,
  CreateRoleDto,
  CreateStaffDto,
  ListUsersQueryDto,
  UpdateStaffDto,
} from './dto/users.dto';

/** System role key that must never be left without a live holder. */
const SUPER_ADMIN_KEY = 'SUPER_ADMIN';
/** The STUDENT role is granted ONLY by the activation ceremony, never by admins. */
const STUDENT_ROLE_KEY = 'STUDENT';

/** Scope breadth ordering: GLOBAL is broadest (0), PROGRAMME narrowest (3). */
const SCOPE_RANK: Record<ScopeType, number> = {
  GLOBAL: 0,
  FACULTY: 1,
  DEPARTMENT: 2,
  PROGRAMME: 3,
};

const userWithRoles = {
  roleAssignments: {
    include: { role: { select: { id: true, key: true, name: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.UserInclude;

type UserWithRoles = Prisma.UserGetPayload<{ include: typeof userWithRoles }>;

/**
 * Admin user management (Phase 1 — "University User Management").
 *
 * Provisions and governs STAFF login accounts and their scoped role assignments.
 * Two security properties are enforced here at the business layer (never by the
 * frontend):
 *
 *  - GRANT-AUTHORITY / least privilege: an administrator may only assign (or
 *    revoke, or bake into a new role) a role whose permissions are a SUBSET of
 *    the permissions they themselves hold. This makes privilege escalation via
 *    role assignment impossible — delegated through RbacService.
 *  - SCOPE INTEGRITY: a role may only be assigned at its own scopeKind or
 *    narrower, and the supplied scope id must reference a real structure entity.
 *
 * There is deliberately no method that creates a STUDENT login or attaches a
 * studentRecordId — student accounts exist solely via the activation ceremony.
 */
@Injectable()
export class UsersService {
  private readonly resetTtlMin: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
    private readonly config: ConfigService,
  ) {
    this.resetTtlMin = this.config.get<number>('PASSWORD_RESET_TTL_MINUTES', 30);
  }

  // --- Staff accounts -----------------------------------------------------

  /** Create a STAFF account with a temporary, must-change password. */
  async createStaff(dto: CreateStaffDto, actor: AuthPrincipal, ctx: RequestContext) {
    const email = dto.email.trim().toLowerCase();

    const violations = this.passwords.validateStrength(dto.temporaryPassword);
    if (violations.length) throw new BadRequestException(violations);

    let created: UserWithRoles;
    try {
      created = await this.prisma.user.create({
        data: {
          userType: 'STAFF',
          email,
          fullName: dto.fullName.trim(),
          passwordHash: await this.passwords.hash(dto.temporaryPassword),
          mustChangePassword: true,
          createdById: actor.userId,
        },
        include: userWithRoles,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        // Uniqueness is a DB constraint (email @unique) — not just an app check.
        throw new ConflictException('An account with that email already exists');
      }
      throw err;
    }

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'user.create',
      entityType: 'User',
      entityId: created.id,
      metadata: { email, userType: 'STAFF' },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return this.sanitize(created);
  }

  /** Paginated, filterable staff directory (never returns password hashes). */
  async listStaff(query: ListUsersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const and: Prisma.UserWhereInput[] = [{ userType: 'STAFF' }];
    if (typeof query.isActive === 'boolean') and.push({ isActive: query.isActive });
    if (query.roleKey) {
      and.push({ roleAssignments: { some: { role: { key: query.roleKey } } } });
    }
    if (query.search) {
      const s = query.search.trim();
      and.push({
        OR: [
          { fullName: { contains: s, mode: 'insensitive' } },
          { email: { contains: s } }, // citext → already case-insensitive
        ],
      });
    }
    const where: Prisma.UserWhereInput = { AND: and };

    const orderBy = this.buildOrderBy(query.sortBy, query.sortDir);
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        include: userWithRoles,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return { items: rows.map((u) => this.sanitize(u)), page, pageSize, total };
  }

  /** Full detail for one staff account. */
  async getStaff(id: string) {
    const user = await this.prisma.user.findFirst({
      where: { id, userType: 'STAFF' },
      include: userWithRoles,
    });
    if (!user) throw new NotFoundException('User not found');
    return this.sanitize(user);
  }

  /** Update mutable staff fields (name, login email). */
  async updateStaff(id: string, dto: UpdateStaffDto, actor: AuthPrincipal, ctx: RequestContext) {
    const existing = await this.requireStaff(id);

    const data: Prisma.UserUpdateInput = {};
    if (dto.fullName !== undefined) data.fullName = dto.fullName.trim();
    if (dto.email !== undefined) data.email = dto.email.trim().toLowerCase();
    if (Object.keys(data).length === 0) return this.sanitize(existing);

    let updated: UserWithRoles;
    try {
      updated = await this.prisma.user.update({
        where: { id },
        data,
        include: userWithRoles,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('An account with that email already exists');
      }
      throw err;
    }

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'user.update',
      entityType: 'User',
      entityId: id,
      before: { fullName: existing.fullName, email: existing.email },
      after: { fullName: updated.fullName, email: updated.email },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return this.sanitize(updated);
  }

  /** Deactivate or reactivate a staff account. Deactivation kills live sessions. */
  async setActive(id: string, isActive: boolean, actor: AuthPrincipal, ctx: RequestContext) {
    const existing = await this.requireStaff(id);
    if (!isActive && id === actor.userId) {
      throw new BadRequestException('You cannot deactivate your own account');
    }
    if (!isActive && existing.isActive) {
      // Never allow removing the last route to super-admin authority.
      await this.assertNotLastSuperAdmin(id);
    }
    if (existing.isActive === isActive) return this.sanitize(existing);

    const updated = await this.prisma.user.update({
      where: { id },
      data: { isActive },
      include: userWithRoles,
    });
    if (!isActive) await this.revokeSessions(id);

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: isActive ? 'user.reactivate' : 'user.deactivate',
      entityType: 'User',
      entityId: id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return this.sanitize(updated);
  }

  /**
   * Admin-initiated credential reset. Issues a hashed, single-use reset token
   * (returned once for out-of-band handoff), forces a change on next login, and
   * revokes all live sessions. The admin never sets or sees the new password.
   */
  async resetCredentials(id: string, actor: AuthPrincipal, ctx: RequestContext) {
    await this.requireStaff(id);
    const rawToken = generateToken(32);

    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id }, data: { mustChangePassword: true } }),
      this.prisma.passwordReset.create({
        data: {
          userId: id,
          tokenHash: sha256(rawToken),
          expiresAt: new Date(Date.now() + this.resetTtlMin * 60_000),
        },
      }),
      this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'user.password.reset',
      entityType: 'User',
      entityId: id,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { resetToken: rawToken, expiresInSec: this.resetTtlMin * 60 };
  }

  // --- Role assignment ----------------------------------------------------

  /** Assign a scoped role to a staff user, enforcing grant-authority + scope. */
  async assignRole(userId: string, dto: AssignRoleDto, actor: AuthPrincipal, ctx: RequestContext) {
    await this.requireStaff(userId);

    const role = await this.prisma.role.findUnique({ where: { id: dto.roleId } });
    if (!role) throw new NotFoundException('Role not found');
    if (role.key === STUDENT_ROLE_KEY) {
      throw new ForbiddenException('The student role is granted only through activation');
    }

    // Grant-authority: actor must already hold every permission in the role.
    const missing = await this.rbac.permissionsActorCannotGrant(actor.userId, dto.roleId);
    if (missing.length) {
      throw new ForbiddenException({
        message: 'You cannot grant a role that includes permissions you do not hold',
        details: { missingPermissions: missing },
      });
    }

    const scope = await this.resolveScope(role.scopeKind, dto);

    let assignment: RoleAssignment;
    try {
      assignment = await this.prisma.roleAssignment.create({
        data: {
          userId,
          roleId: dto.roleId,
          scopeType: dto.scopeType,
          facultyId: scope.facultyId,
          departmentId: scope.departmentId,
          programmeId: scope.programmeId,
          grantedById: actor.userId,
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('The user already holds this role at that scope');
      }
      throw err;
    }

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'user.role.assign',
      entityType: 'RoleAssignment',
      entityId: assignment.id,
      metadata: {
        targetUserId: userId,
        roleKey: role.key,
        scopeType: dto.scopeType,
        facultyId: scope.facultyId,
        departmentId: scope.departmentId,
        programmeId: scope.programmeId,
      },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return this.sanitize(await this.reloadUser(userId));
  }

  /** Revoke a role assignment. Requires the same grant-authority as assigning it. */
  async revokeRole(
    userId: string,
    assignmentId: string,
    actor: AuthPrincipal,
    ctx: RequestContext,
  ) {
    const assignment = await this.prisma.roleAssignment.findUnique({
      where: { id: assignmentId },
      include: { role: { select: { key: true } } },
    });
    if (!assignment || assignment.userId !== userId) {
      throw new NotFoundException('Role assignment not found');
    }

    // Symmetric authority: you may only revoke what you could have granted.
    const missing = await this.rbac.permissionsActorCannotGrant(actor.userId, assignment.roleId);
    if (missing.length) {
      throw new ForbiddenException({
        message: 'You cannot revoke a role that includes permissions you do not hold',
        details: { missingPermissions: missing },
      });
    }
    if (assignment.role.key === SUPER_ADMIN_KEY) {
      await this.assertNotLastSuperAdmin(userId);
    }

    await this.prisma.roleAssignment.delete({ where: { id: assignmentId } });

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'user.role.revoke',
      entityType: 'RoleAssignment',
      entityId: assignmentId,
      metadata: { targetUserId: userId, roleKey: assignment.role.key },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return this.sanitize(await this.reloadUser(userId));
  }

  // --- Roles & permissions (catalog reads + custom role creation) ---------

  /** List all roles, flagging which ones THIS actor is authorized to grant. */
  async listRoles(actor: AuthPrincipal) {
    const [roles, actorPerms] = await Promise.all([
      this.prisma.role.findMany({
        orderBy: { name: 'asc' },
        include: { rolePermissions: { include: { permission: { select: { key: true } } } } },
      }),
      this.rbac.getEffectivePermissions(actor.userId),
    ]);

    return roles.map((r) => {
      const permissions = r.rolePermissions.map((rp) => rp.permission.key);
      return {
        id: r.id,
        key: r.key,
        name: r.name,
        description: r.description,
        isSystem: r.isSystem,
        scopeKind: r.scopeKind,
        permissions,
        // Grant-authority preview so the UI can disable un-grantable roles —
        // the backend re-checks on assign regardless.
        grantable: r.key !== STUDENT_ROLE_KEY && permissions.every((p) => actorPerms.has(p)),
      };
    });
  }

  /** The full permission catalog, grouped by category (for admin UIs). */
  async listPermissions() {
    const perms = await this.prisma.permission.findMany({ orderBy: { key: 'asc' } });
    return perms.map((p) => ({ key: p.key, description: p.description, category: p.category }));
  }

  /** Create a custom (non-system) role; grant-authority applies to its perms. */
  async createRole(dto: CreateRoleDto, actor: AuthPrincipal, ctx: RequestContext) {
    const keys = [...new Set(dto.permissionKeys.map((k) => k.trim()).filter(Boolean))];
    if (keys.length === 0)
      throw new BadRequestException('A role must include at least one permission');

    const found = await this.prisma.permission.findMany({ where: { key: { in: keys } } });
    if (found.length !== keys.length) {
      const known = new Set(found.map((p) => p.key));
      throw new BadRequestException({
        message: 'Unknown permission key(s)',
        details: { unknown: keys.filter((k) => !known.has(k)) },
      });
    }

    // Grant-authority: cannot mint a role granting permissions you lack.
    const actorPerms = await this.rbac.getEffectivePermissions(actor.userId);
    const missing = keys.filter((k) => !actorPerms.has(k));
    if (missing.length) {
      throw new ForbiddenException({
        message: 'You cannot create a role with permissions you do not hold',
        details: { missingPermissions: missing },
      });
    }

    let role: Role;
    try {
      role = await this.prisma.role.create({
        data: {
          key: dto.key.trim().toUpperCase(),
          name: dto.name.trim(),
          description: dto.description?.trim() ?? '',
          scopeKind: dto.scopeKind,
          isSystem: false,
          rolePermissions: { create: found.map((p) => ({ permissionId: p.id })) },
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('A role with that key already exists');
      }
      throw err;
    }

    await this.audit.record({
      actorId: actor.userId,
      actorLabel: actor.email,
      action: 'role.create',
      entityType: 'Role',
      entityId: role.id,
      metadata: { key: role.key, permissions: keys },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return { id: role.id, key: role.key, name: role.name, scopeKind: role.scopeKind };
  }

  // --- Internals ----------------------------------------------------------

  private async requireStaff(id: string): Promise<UserWithRoles> {
    const user = await this.prisma.user.findFirst({
      where: { id, userType: 'STAFF' },
      include: userWithRoles,
    });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  private reloadUser(id: string): Promise<UserWithRoles> {
    return this.prisma.user.findUniqueOrThrow({ where: { id }, include: userWithRoles });
  }

  private async revokeSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * Validate the requested scope against the role's scopeKind and resolve the
   * single owning id. A role may be assigned at its scopeKind or NARROWER only,
   * and exactly the id matching scopeType must be supplied and must exist.
   */
  private async resolveScope(
    roleScopeKind: ScopeType,
    dto: AssignRoleDto,
  ): Promise<{
    facultyId: string | null;
    departmentId: string | null;
    programmeId: string | null;
  }> {
    if (SCOPE_RANK[dto.scopeType] < SCOPE_RANK[roleScopeKind]) {
      throw new BadRequestException(
        `This role may only be assigned at ${roleScopeKind} scope or narrower`,
      );
    }

    const out = {
      facultyId: null as string | null,
      departmentId: null as string | null,
      programmeId: null as string | null,
    };
    switch (dto.scopeType) {
      case 'GLOBAL':
        return out;
      case 'FACULTY': {
        if (!dto.facultyId)
          throw new BadRequestException('facultyId is required for FACULTY scope');
        if (!(await this.prisma.faculty.findUnique({ where: { id: dto.facultyId } }))) {
          throw new BadRequestException('facultyId does not reference a real faculty');
        }
        out.facultyId = dto.facultyId;
        return out;
      }
      case 'DEPARTMENT': {
        if (!dto.departmentId) {
          throw new BadRequestException('departmentId is required for DEPARTMENT scope');
        }
        if (!(await this.prisma.department.findUnique({ where: { id: dto.departmentId } }))) {
          throw new BadRequestException('departmentId does not reference a real department');
        }
        out.departmentId = dto.departmentId;
        return out;
      }
      case 'PROGRAMME': {
        if (!dto.programmeId) {
          throw new BadRequestException('programmeId is required for PROGRAMME scope');
        }
        if (!(await this.prisma.programme.findUnique({ where: { id: dto.programmeId } }))) {
          throw new BadRequestException('programmeId does not reference a real programme');
        }
        out.programmeId = dto.programmeId;
        return out;
      }
    }
  }

  /**
   * Guard against locking the platform out of super-admin authority. Throws if
   * `excludingUserId` is the only active user currently holding SUPER_ADMIN.
   */
  private async assertNotLastSuperAdmin(excludingUserId: string): Promise<void> {
    const role = await this.prisma.role.findUnique({ where: { key: SUPER_ADMIN_KEY } });
    if (!role) return;
    const others = await this.prisma.user.count({
      where: {
        id: { not: excludingUserId },
        isActive: true,
        roleAssignments: { some: { roleId: role.id } },
      },
    });
    if (others === 0) {
      throw new BadRequestException(
        'This is the last active super administrator and cannot be removed',
      );
    }
  }

  private buildOrderBy(
    sortBy: string | undefined,
    sortDir: string | undefined,
  ): Prisma.UserOrderByWithRelationInput {
    const dir = sortDirection(sortDir);
    switch (sortBy) {
      case 'email':
        return { email: dir };
      case 'createdAt':
        return { createdAt: dir };
      case 'lastLoginAt':
        return { lastLoginAt: dir };
      default:
        return { fullName: dir };
    }
  }

  /** Map a User row to the public shape — NEVER includes the password hash. */
  private sanitize(user: UserWithRoles | User) {
    const roles =
      'roleAssignments' in user
        ? user.roleAssignments.map((ra) => ({
            assignmentId: ra.id,
            roleId: ra.roleId,
            roleKey: ra.role.key,
            roleName: ra.role.name,
            scopeType: ra.scopeType,
            facultyId: ra.facultyId,
            departmentId: ra.departmentId,
            programmeId: ra.programmeId,
            grantedById: ra.grantedById,
            grantedAt: ra.createdAt,
          }))
        : [];
    return {
      id: user.id,
      email: user.email,
      fullName: user.fullName,
      userType: user.userType,
      isActive: user.isActive,
      mustChangePassword: user.mustChangePassword,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles,
    };
  }
}
