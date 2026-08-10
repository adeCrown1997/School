import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';
import { validateEnv } from './env.validation';

/**
 * Global configuration module. Loads .env, validates it, and exposes a typed
 * ConfigService everywhere. `isGlobal` so feature modules need not re-import.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      // Load repo-root .env (monorepo) — apps/api runs from its own cwd.
      envFilePath: ['.env', '../../.env'],
      validate: validateEnv,
    }),
  ],
})
export class ConfigModule {}
