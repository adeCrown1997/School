import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DashboardsService } from './dashboards.service';
import { DashboardsController } from './dashboards.controller';

/**
 * Dashboards module. Imports AuthModule for the JwtAuthGuard/PermissionsGuard
 * used by the controller. All metrics come from the database via PrismaService
 * (a @Global provider), so no additional data providers are needed.
 */
@Module({
  imports: [AuthModule],
  providers: [DashboardsService],
  controllers: [DashboardsController],
})
export class DashboardsModule {}
