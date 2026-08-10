import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';
import { AuthPrincipal } from '../common/auth-principal';
import { PERMISSIONS } from '../rbac/permissions.catalog';

/**
 * The PermissionsGuard is the backend authorization boundary — the requirement
 * from the brief that "every protected API endpoint must independently verify
 * authorization" and that unauthorized attempts are rejected server-side. These
 * tests exercise it directly rather than trusting any frontend behaviour.
 */
function contextWith(user: AuthPrincipal | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function guardRequiring(required: readonly string[] | undefined): PermissionsGuard {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  return new PermissionsGuard(reflector);
}

const principal = (permissions: string[]): AuthPrincipal => ({
  userId: 'u1',
  userType: 'STAFF',
  email: 'a@b.c',
  fullName: 'A',
  permissions,
  scopedPermissions: [],
});

describe('PermissionsGuard', () => {
  it('allows routes with no @RequirePermissions metadata', () => {
    expect(guardRequiring(undefined).canActivate(contextWith(principal([])))).toBe(true);
  });

  it('allows routes with an empty required list', () => {
    expect(guardRequiring([]).canActivate(contextWith(principal([])))).toBe(true);
  });

  it('rejects an unauthenticated request when a permission is required', () => {
    expect(() =>
      guardRequiring([PERMISSIONS.STUDENTS_VIEW]).canActivate(contextWith(undefined)),
    ).toThrow(UnauthorizedException);
  });

  it('allows a principal holding every required permission', () => {
    const guard = guardRequiring([PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_CREATE]);
    const user = principal([
      PERMISSIONS.STUDENTS_VIEW,
      PERMISSIONS.STUDENTS_CREATE,
      PERMISSIONS.AUDIT_VIEW,
    ]);
    expect(guard.canActivate(contextWith(user))).toBe(true);
  });

  it('rejects a principal missing any one required permission', () => {
    const guard = guardRequiring([PERMISSIONS.STUDENTS_VIEW, PERMISSIONS.STUDENTS_CREATE]);
    const user = principal([PERMISSIONS.STUDENTS_VIEW]); // missing create
    expect(() => guard.canActivate(contextWith(user))).toThrow(ForbiddenException);
  });

  it('does not disclose WHICH permission was missing in the error message', () => {
    const guard = guardRequiring([PERMISSIONS.STUDENTS_CREATE]);
    try {
      guard.canActivate(contextWith(principal([])));
      fail('expected a ForbiddenException');
    } catch (err) {
      expect(err).toBeInstanceOf(ForbiddenException);
      expect((err as Error).message).not.toContain(PERMISSIONS.STUDENTS_CREATE);
    }
  });
});
