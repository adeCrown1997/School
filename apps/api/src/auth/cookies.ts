import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { IssuedTokens } from './auth.service';

/**
 * Centralized auth-cookie handling. Tokens live in httpOnly cookies so client
 * JavaScript cannot read them (mitigates XSS token theft). SameSite=Lax guards
 * against CSRF on top-level navigations; state-changing endpoints are POST/JSON
 * and additionally protected by SameSite. Secure is toggled by env for HTTPS.
 */
export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

export function setAuthCookies(res: Response, tokens: IssuedTokens, config: ConfigService): void {
  const secure = config.get<boolean>('COOKIE_SECURE', false);
  const domain = config.get<string>('COOKIE_DOMAIN', 'localhost');
  const base = {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    domain,
    path: '/',
  };
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    maxAge: tokens.accessTtlSec * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    // Refresh cookie is only sent to the refresh + logout endpoints.
    path: '/api/v1/auth',
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response, config: ConfigService): void {
  const secure = config.get<boolean>('COOKIE_SECURE', false);
  const domain = config.get<string>('COOKIE_DOMAIN', 'localhost');
  const base = { httpOnly: true, secure, sameSite: 'lax' as const, domain };
  res.clearCookie(ACCESS_COOKIE, { ...base, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, path: '/api/v1/auth' });
}
