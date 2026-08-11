import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ALLOW_PASSWORD_CHANGE_PENDING_KEY, IS_PUBLIC_KEY } from './decorators';
import { AuthPrincipal } from '../common/auth-principal';

/**
 * Blocks every authenticated route while the principal still holds the initial
 * password issued at activation (the student's surname).
 *
 * This is the server-side half of "the student must be forced to change the
 * password before accessing the dashboard". The web app also redirects, but a
 * redirect is only a convenience — a student who skips the UI and calls the API
 * directly is stopped here, so the requirement holds regardless of client.
 *
 * Runs AFTER JwtAuthGuard (which populates req.user) and before the permission
 * check: an un-rotated password is a bar on the whole session, not a
 * per-permission concern. Public routes and the three escape-hatch routes marked
 * @AllowPasswordChangePending pass through.
 */
@Injectable()
export class PasswordChangeGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) return true;
    if (this.reflector.getAllAndOverride<boolean>(ALLOW_PASSWORD_CHANGE_PENDING_KEY, targets)) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>();
    // No principal means JwtAuthGuard already rejected, or the route is outside
    // the authenticated surface. Either way this guard has nothing to add.
    if (!req.user) return true;

    if (req.user.mustChangePassword) {
      // A distinct, machine-readable code: the client needs to tell "change your
      // password" apart from an ordinary authorization failure so it can route to
      // the change-password screen instead of showing "access denied".
      // `code` (not a custom key) because AllExceptionsFilter copies that field
      // into the error envelope — anything else would be dropped on the way out.
      throw new ForbiddenException({
        code: 'PASSWORD_CHANGE_REQUIRED',
        message: 'Password change required before continuing',
      });
    }
    return true;
  }
}
