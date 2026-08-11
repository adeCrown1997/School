import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PasswordChangeGuard } from './password-change.guard';
import { ALLOW_PASSWORD_CHANGE_PENDING_KEY, IS_PUBLIC_KEY } from './decorators';
import { AuthPrincipal } from '../common/auth-principal';

/**
 * "After the first successful login, the student must be forced to change the
 * password before accessing the dashboard" is enforced server-side, so it is
 * tested server-side: a client that skips the redirect and calls the API
 * directly must still be stopped.
 *
 * The escape hatches are the interesting part. The guard is global, so if it
 * blocked EVERY route it would also block /auth/change-password and lock the
 * student out permanently. These tests pin down exactly which routes stay open.
 */
function contextWith(user: AuthPrincipal | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

/** Reflector that reports only the given metadata key as present on the route. */
function guardWithMetadata(presentKey?: string): PasswordChangeGuard {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => key === presentKey),
  } as unknown as Reflector;
  return new PasswordChangeGuard(reflector);
}

const principal = (mustChangePassword: boolean): AuthPrincipal => ({
  userId: 'u-student',
  userType: 'STUDENT',
  email: 'student@uni.example',
  fullName: 'Ada Bello',
  permissions: [],
  scopedPermissions: [],
  matriculationNumber: 'AGE/2021/001',
  mustChangePassword,
});

describe('PasswordChangeGuard', () => {
  it('blocks a principal still holding the initial password', () => {
    expect(() => guardWithMetadata().canActivate(contextWith(principal(true)))).toThrow(
      ForbiddenException,
    );
  });

  it('reports a machine-readable code so the client can route to the change screen', () => {
    try {
      guardWithMetadata().canActivate(contextWith(principal(true)));
      fail('expected a ForbiddenException');
    } catch (err) {
      // `code` specifically — AllExceptionsFilter copies that field into the
      // error envelope, so a differently-named key would never reach the client.
      const body = (err as ForbiddenException).getResponse() as { code?: string };
      expect(body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    }
  });

  it('allows a principal who has rotated the password', () => {
    expect(guardWithMetadata().canActivate(contextWith(principal(false)))).toBe(true);
  });

  it('allows public routes, which have no principal to check', () => {
    expect(guardWithMetadata(IS_PUBLIC_KEY).canActivate(contextWith(undefined))).toBe(true);
  });

  it('allows @AllowPasswordChangePending routes — the change-password escape hatch', () => {
    // Without this, /auth/change-password would itself be blocked and the
    // student could never leave the pending state.
    const guard = guardWithMetadata(ALLOW_PASSWORD_CHANGE_PENDING_KEY);
    expect(guard.canActivate(contextWith(principal(true)))).toBe(true);
  });

  it('defers to JwtAuthGuard when no principal was attached', () => {
    expect(guardWithMetadata().canActivate(contextWith(undefined))).toBe(true);
  });
});
