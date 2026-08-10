import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { UsersService } from './users.service';
import { UsersController } from './users.controller';
import { RolesController } from './roles.controller';

/**
 * University User Management (Phase 1). Imports AuthModule for PasswordService;
 * PrismaModule, RbacModule and AuditModule are @Global. Exposes staff account
 * administration and scoped role assignment with backend-enforced
 * grant-authority.
 */
@Module({
  imports: [AuthModule],
  controllers: [UsersController, RolesController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
