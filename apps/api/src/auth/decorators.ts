import { SetMetadata } from '@nestjs/common';
import { PermissionKey } from '../rbac/permissions.catalog';

/** Marks a route as public — the JwtAuthGuard will skip authentication. */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/**
 * Declares the permissions a route requires. The PermissionsGuard grants access
 * only if the principal holds ALL listed permissions. Order-independent.
 * A route with no @RequirePermissions is authenticated-only (any logged-in user).
 */
export const PERMISSIONS_KEY = 'requiredPermissions';
export const RequirePermissions = (...perms: PermissionKey[]) =>
  SetMetadata(PERMISSIONS_KEY, perms);

/**
 * Exempts a route from the forced-password-change gate.
 *
 * A user who still holds the initial password issued at activation is blocked
 * from EVERY authenticated route by the PasswordChangeGuard. That has to leave a
 * way out, or the account would be locked in a state it cannot exit: the user
 * needs to read their own session, change the password, and sign out. Those
 * three routes carry this marker; nothing else should.
 */
export const ALLOW_PASSWORD_CHANGE_PENDING_KEY = 'allowPasswordChangePending';
export const AllowPasswordChangePending = () =>
  SetMetadata(ALLOW_PASSWORD_CHANGE_PENDING_KEY, true);
