import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { IS_PUBLIC_KEY } from './decorators';
import { AccessTokenPayload, AuthPrincipal } from '../common/auth-principal';
import { RbacService } from '../rbac/rbac.service';

/**
 * Authenticates a request from the access-token cookie (or Authorization
 * bearer, for API clients). On success attaches a freshly-resolved
 * AuthPrincipal to req.user.
 *
 * Design choice: rather than trust the permission snapshot inside the JWT, the
 * guard re-resolves permissions from the DB on every request via RbacService.
 * This means deactivating a user or revoking a role takes effect immediately,
 * not at token expiry — important for a system where authority changes matter.
 * (The JWT still bounds session lifetime and carries identity.)
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly rbac: RbacService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { user?: AuthPrincipal }>();
    const token = this.extractToken(req);
    if (!token) throw new UnauthorizedException('Authentication required');

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }

    // Re-resolve the live principal; rejects if the user was deactivated.
    const principal = await this.rbac.resolvePrincipal(payload.sub);
    if (!principal) throw new UnauthorizedException('Account is not active');

    req.user = principal;
    return true;
  }

  private extractToken(req: Request): string | undefined {
    const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
    if (cookies?.access_token) return cookies.access_token;
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) return auth.slice(7);
    return undefined;
  }
}
