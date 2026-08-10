import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from './decorators';
import { PermissionKey } from '../rbac/permissions.catalog';
import { AuthPrincipal } from '../common/auth-principal';

/**
 * Authorizes a request against the @RequirePermissions metadata. Runs AFTER
 * JwtAuthGuard, so req.user is present. Enforces that the principal holds every
 * required permission. This is independent, backend-side enforcement — the
 * frontend hiding a link is never the security boundary.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PermissionKey[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    const user = req.user;
    if (!user) throw new UnauthorizedException('Authentication required');

    const held = new Set(user.permissions);
    const missing = required.filter((p) => !held.has(p));
    if (missing.length > 0) {
      // Generic message — do not enumerate which permission was missing to a
      // caller who lacks it beyond the high-level requirement.
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
