import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardsService } from './dashboards.service';
import { AcademicUnitDashboardService } from './academic-unit-dashboard.service';
import { FinanceDashboardService } from './finance-dashboard.service';
import { LecturerDashboardService } from './lecturer-dashboard.service';
import { OperationsDashboardService } from './operations-dashboard.service';
import { DashboardsController } from './dashboards.controller';

/**
 * Dashboards module. Imports AuthModule for the JwtAuthGuard/PermissionsGuard
 * used by the controller. All metrics come from the database via PrismaService
 * (a @Global provider), so no additional data providers are needed.
 *
 * One service per dashboard family keeps each role's projection isolated:
 *   DashboardsService          — the existing admin + student overviews
 *   AcademicUnitDashboardService — adviser / department / faculty tiers
 *   FinanceDashboardService    — the bursary (revenue, waivers, verification)
 *   LecturerDashboardService   — teaching load + the project/SIWES coordinator
 *   OperationsDashboardService — registry, admissions, exams, clearance units,
 *                                registrar and VC executive views
 */
@Module({
  imports: [AuthModule],
  providers: [
    DashboardsService,
    AcademicUnitDashboardService,
    FinanceDashboardService,
    LecturerDashboardService,
    OperationsDashboardService,
  ],
  controllers: [DashboardsController],
})
export class DashboardsModule {}
