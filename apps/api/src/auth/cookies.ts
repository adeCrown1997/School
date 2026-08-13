import { CookieOptions, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import type { IssuedTokens } from './auth.service';

/**
 * Centralized auth-cookie handling. Tokens live in httpOnly cookies so client
 * JavaScript cannot read them (mitigates XSS token theft). SameSite=Lax guards
 * against CSRF on top-level navigations; state-changing endpoints are POST/JSON
 * and additionally protected by SameSite. Secure is toggled by env for HTTPS.
 */
export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

/**
 * Chromium, Edge, and Safari reject `Domain=localhost` (it is not a registrable
 * domain). Express then sends `Set-Cookie: …; Domain=localhost`, the browser
 * drops the cookie, login returns 200, and the next `/auth/me` is a 401 — which
 * looks like "credentials don't work" for every account type.
 *
 * Omit the Domain attribute for localhost / loopback so the browser stores a
 * host-only cookie. Production still sets Domain when COOKIE_DOMAIN is a real
 * host (e.g. `.university.edu`).
 */
export function cookieDomainAttribute(domain: string | undefined | null): string | undefined {
  if (domain == null) return undefined;
  const d = domain.trim().toLowerCase();
  if (!d || d === 'localhost' || d === '127.0.0.1' || d === '::1' || d === '[::1]') {
    return undefined;
  }
  return domain.trim();
}

function cookieFlags(config: ConfigService, path: string): CookieOptions {
  const secure = Boolean(config.get<boolean>('COOKIE_SECURE', false));
  const domain = cookieDomainAttribute(config.get<string>('COOKIE_DOMAIN'));
  const flags: CookieOptions = {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path,
  };
  if (domain) flags.domain = domain;
  return flags;
}

export function setAuthCookies(res: Response, tokens: IssuedTokens, config: ConfigService): void {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...cookieFlags(config, '/'),
    maxAge: tokens.accessTtlSec * 1000,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    // Refresh cookie is only sent to the refresh + logout endpoints.
    ...cookieFlags(config, '/api/v1/auth'),
    expires: tokens.refreshExpiresAt,
  });
}

export function clearAuthCookies(res: Response, config: ConfigService): void {
  res.clearCookie(ACCESS_COOKIE, cookieFlags(config, '/'));
  res.clearCookie(REFRESH_COOKIE, cookieFlags(config, '/api/v1/auth'));
}
