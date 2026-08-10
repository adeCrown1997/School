import { Global, Module } from '@nestjs/common';
import { RbacService } from './rbac.service';

/**
 * Global RBAC module. Exported so the auth guards (which live in the auth
 * module) and every feature module can resolve principals and check
 * grant-authority without re-wiring providers.
 */
@Global()
@Module({
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}
