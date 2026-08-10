import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';
import { AuthModule } from '../auth/auth.module';

/**
 * Global audit module — every feature module records via AuditService.
 *
 * AuthModule is imported because AuditController is protected by JwtAuthGuard:
 * a guard named in @UseGuards is instantiated in the *declaring* module's
 * injector, so its own dependencies (JwtService) must be resolvable here. Being
 * @Global() exports AuditService outward; it does not import anything inward.
 */
@Global()
@Module({
  imports: [AuthModule],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
