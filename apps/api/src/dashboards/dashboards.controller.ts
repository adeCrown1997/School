import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/decorators';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPrincipal } from '../common/auth-principal';
import { ok } from '../common/api-response';
import { DashboardsService } from './dashboards.service';
import { AcademicUnitDashboardService } from './academic-unit-dashboard.service';
import { FinanceDashboardService } from './finance-dashboard.service';
import { LecturerDashboardService } from './lecturer-dashboard.service';
import { OperationsDashboardService } from './operations-dashboard.service';

/**
 * Role dashboards under /api/v1/dashboards.
 *
 * Every route is AUTHENTICATED (JwtAuthGuard) AND AUTHORIZED (PermissionsGuard)
 * independently of the frontend: the controller is the security boundary, and
 * each role endpoint is gated on its own dashboard permission. The services then
 * re-derive the actor's scope for every figure they compute, so holding the
 * permission at no usable scope yields an honest zero, never out-of-range data.
 *
 * The admin overview and student overview keep their existing endpoints and
 * behaviour; the role endpoints are additive and never touch them.
 */
@Controller('dashboards')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DashboardsController {
  constructor(
    private readonly dashboards: DashboardsService,
    private readonly academicUnit: AcademicUnitDashboardService,
    private readonly finance: FinanceDashboardService,
    private readonly lecturerDashboards: LecturerDashboardService,
    private readonly operations: OperationsDashboardService,
  ) {}

  // --- Existing (unchanged) -----------------------------------------------------

  @Get('admin')
  @RequirePermissions(PERMISSIONS.DASHBOARD_ADMIN_VIEW)
  async admin(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.dashboards.adminOverview(user));
  }

  @Get('me')
  async me(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.dashboards.studentOverview(user));
  }

  // --- Academic units ------------------------------------------------------------

  @Get('lecturer')
  @RequirePermissions(PERMISSIONS.DASHBOARD_LECTURER_VIEW)
  async lecturer(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.lecturerDashboards.lecturerOverview(user));
  }

  @Get('adviser')
  @RequirePermissions(PERMISSIONS.DASHBOARD_ADVISER_VIEW)
  async adviser(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.academicUnit.adviserOverview(user));
  }

  @Get('department')
  @RequirePermissions(PERMISSIONS.DASHBOARD_HOD_VIEW)
  async department(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.academicUnit.departmentOverview(user));
  }

  @Get('faculty')
  @RequirePermissions(PERMISSIONS.DASHBOARD_FACULTY_VIEW)
  async faculty(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.academicUnit.facultyOverview(user));
  }

  // --- Finance ------------------------------------------------------------------

  @Get('bursar')
  @RequirePermissions(PERMISSIONS.DASHBOARD_BURSAR_VIEW)
  async bursar(@CurrentUser() user: AuthPrincipal, @Query('sessionId') sessionId?: string) {
    return ok(await this.finance.overview(user, sessionId));
  }

  // --- Operations ----------------------------------------------------------------

  @Get('registry')
  @RequirePermissions(PERMISSIONS.DASHBOARD_REGISTRY_VIEW)
  async registry(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.operations.registryOverview(user));
  }

  @Get('admissions')
  @RequirePermissions(PERMISSIONS.DASHBOARD_ADMISSIONS_VIEW)
  async admissions(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.operations.admissionsOverview(user));
  }

  @Get('exams')
  @RequirePermissions(PERMISSIONS.DASHBOARD_EXAMS_VIEW)
  async exams(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.operations.examsOverview(user));
  }

  @Get('library')
  @RequirePermissions(PERMISSIONS.DASHBOARD_LIBRARY_VIEW)
  async library(@CurrentUser() user: AuthPrincipal) {
    return ok(
      await this.operations.clearanceUnitOverview(user, 'DASHBOARD_LIBRARY_VIEW', 'LIBRARY'),
    );
  }

  @Get('student-affairs')
  @RequirePermissions(PERMISSIONS.DASHBOARD_AFFAIRS_VIEW)
  async studentAffairs(@CurrentUser() user: AuthPrincipal) {
    return ok(
      await this.operations.clearanceUnitOverview(
        user,
        'DASHBOARD_AFFAIRS_VIEW',
        'STUDENT_AFFAIRS',
      ),
    );
  }

  @Get('hostel')
  @RequirePermissions(PERMISSIONS.DASHBOARD_HOSTEL_VIEW)
  async hostel(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.operations.clearanceUnitOverview(user, 'DASHBOARD_HOSTEL_VIEW', 'HOSTEL'));
  }

  @Get('project')
  @RequirePermissions(PERMISSIONS.DASHBOARD_PROJECT_VIEW)
  async project(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.lecturerDashboards.projectOverview(user));
  }

  // --- Executive / institution-wide ------------------------------------------------

  @Get('registrar')
  @RequirePermissions(PERMISSIONS.DASHBOARD_REGISTRAR_VIEW)
  async registrar(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.operations.universityOverview(user, 'DASHBOARD_REGISTRAR_VIEW'));
  }

  @Get('vice-chancellor')
  @RequirePermissions(PERMISSIONS.DASHBOARD_VC_VIEW)
  async viceChancellor(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.operations.universityOverview(user, 'DASHBOARD_VC_VIEW'));
  }
}
