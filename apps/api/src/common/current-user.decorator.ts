import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthPrincipal } from './auth-principal';

/**
 * Injects the authenticated principal into a handler parameter. Throws 401 if
 * the route was not protected by the auth guard (defensive — prevents a
 * handler from silently running with an undefined user).
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthPrincipal => {
    const req = ctx.switchToHttp().getRequest<{ user?: AuthPrincipal }>();
    if (!req.user) {
      throw new UnauthorizedException('Authentication required');
    }
    return req.user;
  },
);
