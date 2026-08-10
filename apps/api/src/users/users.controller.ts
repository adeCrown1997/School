import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/decorators';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPrincipal } from '../common/auth-principal';
import { paginatedResponse } from '../common/pagination';
import { ok } from '../common/api-response';
import { UsersService } from './users.service';
import {
  AssignRoleDto,
  CreateStaffDto,
  ListUsersQueryDto,
  SetActiveDto,
  UpdateStaffDto,
} from './dto/users.dto';

/**
 * Admin user-management endpoints under /api/v1/users. Every route independently
 * requires an explicit permission (never relies on the UI hiding it), and each
 * write is authorized at the business layer — grant-authority and scope checks
 * live in UsersService, not here.
 */
@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  private ctx(req: Request) {
    return {
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    };
  }

  @Get()
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  async list(@Query() query: ListUsersQueryDto) {
    return paginatedResponse(await this.users.listStaff(query));
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USERS_CREATE)
  async create(
    @Body() dto: CreateStaffDto,
    @CurrentUser() actor: AuthPrincipal,
    @Req() req: Request,
  ) {
    return ok(await this.users.createStaff(dto, actor, this.ctx(req)));
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.USERS_VIEW)
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return ok(await this.users.getStaff(id));
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.USERS_UPDATE)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateStaffDto,
    @CurrentUser() actor: AuthPrincipal,
    @Req() req: Request,
  ) {
    return ok(await this.users.updateStaff(id, dto, actor, this.ctx(req)));
  }

  @Post(':id/set-active')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.USERS_DEACTIVATE)
  async setActive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SetActiveDto,
    @CurrentUser() actor: AuthPrincipal,
    @Req() req: Request,
  ) {
    return ok(await this.users.setActive(id, dto.isActive, actor, this.ctx(req)));
  }

  @Post(':id/reset-password')
  @HttpCode(200)
  @RequirePermissions(PERMISSIONS.USERS_RESET)
  async resetPassword(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthPrincipal,
    @Req() req: Request,
  ) {
    return ok(await this.users.resetCredentials(id, actor, this.ctx(req)));
  }

  @Post(':id/roles')
  @RequirePermissions(PERMISSIONS.ROLES_ASSIGN)
  async assignRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AssignRoleDto,
    @CurrentUser() actor: AuthPrincipal,
    @Req() req: Request,
  ) {
    return ok(await this.users.assignRole(id, dto, actor, this.ctx(req)));
  }

  @Delete(':id/roles/:assignmentId')
  @RequirePermissions(PERMISSIONS.ROLES_ASSIGN)
  async revokeRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('assignmentId', ParseUUIDPipe) assignmentId: string,
    @CurrentUser() actor: AuthPrincipal,
    @Req() req: Request,
  ) {
    return ok(await this.users.revokeRole(id, assignmentId, actor, this.ctx(req)));
  }
}
