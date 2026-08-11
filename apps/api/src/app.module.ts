import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ConfigModule } from './config/config.module';
import { PrismaModule } from './prisma/prisma.module';
import { RbacModule } from './rbac/rbac.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { NotificationModule } from './notifications/notification.module';
import { UsersModule } from './users/users.module';
import { StructureModule } from './structure/structure.module';
import { StudentsModule } from './students/students.module';
import { AcademicsModule } from './academics/academics.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { HealthController } from './common/health.controller';

/**
 * Root module. Wires the foundation (config, logging, prisma, rbac, audit,
 * throttling) and the feature modules. The ThrottlerGuard is registered as an
 * APP_GUARD so rate limiting applies globally, with per-route overrides via
 * @Throttle on sensitive auth endpoints.
 *
 * NOTE: JwtAuthGuard + PermissionsGuard are applied as global guards in
 * main.ts (they need Reflector + resolved providers), so they are not repeated
 * here. Feature modules are added below as each is implemented.
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      pinoHttp: {
        // Redact anything that could leak credentials/tokens from logs.
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            'req.body.password',
            'req.body.newPassword',
            'req.body.currentPassword',
            'req.body.token',
          ],
          remove: true,
        },
        autoLogging: true,
        level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    PrismaModule,
    RbacModule,
    AuditModule,
    NotificationModule,
    AuthModule,
    UsersModule,
    StructureModule,
    StudentsModule,
    AcademicsModule,
    DashboardsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
