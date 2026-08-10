import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/decorators';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPrincipal } from '../common/auth-principal';
import { ok } from '../common/api-response';
import { DashboardsService } from './dashboards.service';

/**
 * Dashboard endpoints under /api/v1/dashboards. The admin overview is
 * permission-guarded (DASHBOARD_ADMIN_VIEW) and scope-limited inside the
 * service; the student overview is authenticated-only and bound to the caller's
 * own record by ownership (no permission, mirroring the /me self-service model).
 * Both return figures computed live from the database.
 */
@Controller('dashboards')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DashboardsController {
  constructor(private readonly dashboards: DashboardsService) {}

  @Get('admin')
  @RequirePermissions(PERMISSIONS.DASHBOARD_ADMIN_VIEW)
  async admin(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.dashboards.adminOverview(user));
  }

  @Get('me')
  async me(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.dashboards.studentOverview(user));
  }
}
