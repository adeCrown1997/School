import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { PasswordService } from './password.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { PermissionsGuard } from './permissions.guard';

/**
 * Auth module. Exports PasswordService and the guards so other modules can
 * hash passwords (e.g. activation) and protect their routes. JwtModule is
 * registered without a static secret — each sign/verify passes the secret from
 * ConfigService, keeping the secret out of module metadata.
 */
@Module({
  imports: [JwtModule.register({})],
  providers: [AuthService, PasswordService, JwtAuthGuard, PermissionsGuard],
  controllers: [AuthController],
  exports: [AuthService, PasswordService, JwtAuthGuard, PermissionsGuard, JwtModule],
})
export class AuthModule {}
