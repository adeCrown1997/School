import 'reflect-metadata';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/all-exceptions.filter';
import { ResponseEnvelopeInterceptor } from './common/response.interceptor';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { PermissionsGuard } from './auth/permissions.guard';
import { PrismaService } from './prisma/prisma.service';

/**
 * API bootstrap. Applies, in order: security headers (helmet), cookie parsing,
 * CORS locked to the web origin, URI versioning (/api/v1), a strict global
 * validation pipe (whitelist + forbid unknown props + transform), the response
 * envelope interceptor, the catch-all exception filter, and GLOBAL auth +
 * permission guards so every route is protected unless explicitly @Public().
 */
async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  const config = app.get(ConfigService);

  app.use(helmet());
  app.use(cookieParser());

  app.setGlobalPrefix('api');
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.enableCors({
    origin: config.get<string>('WEB_ORIGIN', 'http://localhost:3000'),
    credentials: true, // allow the auth cookies
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, // strip unknown properties
      forbidNonWhitelisted: true, // reject requests carrying unknown properties
      transform: true, // coerce to DTO types
      transformOptions: { enableImplicitConversion: false },
    }),
  );

  app.useGlobalInterceptors(new ResponseEnvelopeInterceptor());
  app.useGlobalFilters(new AllExceptionsFilter());

  // GLOBAL guards: authentication first, then permission check. Combined with
  // @Public()/@RequirePermissions, this makes "secure by default" the norm —
  // a new endpoint is protected unless a developer explicitly opts out.
  const reflector = app.get(Reflector);
  app.useGlobalGuards(app.get(JwtAuthGuard), new PermissionsGuard(reflector));

  // Graceful shutdown closes the DB pool.
  const prisma = app.get(PrismaService);
  await prisma.enableShutdownHooks(app);
  app.enableShutdownHooks();

  const port = config.get<number>('API_PORT', 4000);
  await app.listen(port);
}

void bootstrap();
