import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/decorators';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPrincipal } from '../common/auth-principal';
import { ok } from '../common/api-response';
import { UsersService } from './users.service';
import { CreateRoleDto } from './dto/users.dto';

/**
 * Role + permission administration endpoints. Reads back the role catalog (with
 * a per-actor `grantable` hint) and the permission catalog so an admin UI can be
 * built entirely from the DB. Role creation re-applies grant-authority.
 */
@Controller()
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private readonly users: UsersService) {}

  @Get('roles')
  @RequirePermissions(PERMISSIONS.ROLES_VIEW)
  async listRoles(@CurrentUser() actor: AuthPrincipal) {
    return ok(await this.users.listRoles(actor));
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.ROLES_CREATE)
  async createRole(
    @Body() dto: CreateRoleDto,
    @CurrentUser() actor: AuthPrincipal,
    @Req() req: Request,
  ) {
    const ctx = { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string) ?? null };
    return ok(await this.users.createRole(dto, actor, ctx));
  }

  @Get('permissions')
  @RequirePermissions(PERMISSIONS.PERMISSIONS_VIEW)
  async listPermissions() {
    return ok(await this.users.listPermissions());
  }
}
