import { Global, Module } from '@nestjs/common';
import { NotificationService } from './notification.service';

/**
 * Global notification module. The single trusted outbound channel for secrets
 * that must not travel in HTTP responses (activation OTPs, reset links). Global
 * so any feature module can inject it without re-wiring providers.
 */
@Global()
@Module({
  providers: [NotificationService],
  exports: [NotificationService],
})
export class NotificationModule {}
