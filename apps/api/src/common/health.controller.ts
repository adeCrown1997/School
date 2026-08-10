import { Controller, Get } from '@nestjs/common';
import { Public } from '../auth/decorators';

/** Liveness probe. Public — used by orchestrators/monitors and the web app. */
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { ok: true, data: { status: 'up' } };
  }
}
