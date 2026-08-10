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
