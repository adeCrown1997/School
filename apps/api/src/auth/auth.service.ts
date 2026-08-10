import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PasswordService } from './password.service';
import { AuditService } from '../audit/audit.service';
import { RbacService } from '../rbac/rbac.service';
import { AccessTokenPayload } from '../common/auth-principal';
import { generateToken, sha256 } from '../common/crypto.util';

export interface RequestContext {
  ip?: string | null;
  userAgent?: string | null;
}

export interface IssuedTokens {
  accessToken: string;
  accessTtlSec: number;
  refreshToken: string;
  refreshExpiresAt: Date;
}

/**
 * Authentication service. Responsibilities:
 *  - login: verify credentials (constant-ish work even on unknown email to
 *    reduce enumeration), issue access + refresh tokens.
 *  - refresh: rotate refresh tokens with reuse detection.
 *  - logout: revoke the presented refresh token (and optionally all sessions).
 *  - password change / forgot / reset with hashed, expiring, single-use tokens.
 *
 * Access tokens are short-lived JWTs; refresh tokens are opaque, stored hashed.
 * Raw refresh/reset tokens are returned to the caller once and delivered via
 * httpOnly cookie / out-of-band — never persisted in plaintext.
 */
@Injectable()
export class AuthService {
  private readonly accessTtl: number;
  private readonly refreshTtlDays: number;
  private readonly resetTtlMin: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly passwords: PasswordService,
    private readonly audit: AuditService,
    private readonly rbac: RbacService,
  ) {
    this.accessTtl = this.config.get<number>('JWT_ACCESS_TTL', 900);
    this.refreshTtlDays = this.config.get<number>('REFRESH_TOKEN_TTL_DAYS', 7);
    this.resetTtlMin = this.config.get<number>('PASSWORD_RESET_TTL_MINUTES', 30);
  }

  // --- Login --------------------------------------------------------------
  async login(email: string, password: string, ctx: RequestContext): Promise<IssuedTokens> {
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Always run a verify to keep timing similar for unknown vs known emails.
    const hash =
      user?.passwordHash ??
      '$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const passwordOk = await this.passwords.verify(hash, password);

    if (!user || !user.passwordHash || !passwordOk || !user.isActive) {
      await this.audit.record({
        actorId: user?.id ?? null,
        actorLabel: email,
        action: 'auth.login.failed',
        entityType: 'User',
        entityId: user?.id ?? null,
        metadata: { reason: !user ? 'no_user' : !user.isActive ? 'inactive' : 'bad_password' },
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      // Generic message — never reveal which factor failed.
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.issueTokens(user, ctx);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record({
      actorId: user.id,
      actorLabel: user.email,
      action: 'auth.login.success',
      entityType: 'User',
      entityId: user.id,
      metadata: { userType: user.userType, mustChangePassword: user.mustChangePassword },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    return tokens;
  }

  // --- Token issuance / rotation -----------------------------------------
  private async issueTokens(user: User, ctx: RequestContext): Promise<IssuedTokens> {
    const principal = await this.rbac.resolvePrincipal(user.id);
    const payload: AccessTokenPayload = {
      sub: user.id,
      typ: user.userType,
      perms: principal?.permissions ?? [],
      srid: user.studentRecordId,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      expiresIn: this.accessTtl,
    });

    const refreshToken = generateToken(48);
    const refreshExpiresAt = new Date(Date.now() + this.refreshTtlDays * 86400_000);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256(refreshToken),
        expiresAt: refreshExpiresAt,
        userAgent: ctx.userAgent ?? null,
        ip: ctx.ip ?? null,
      },
    });

    return { accessToken, accessTtlSec: this.accessTtl, refreshToken, refreshExpiresAt };
  }

  async refresh(rawRefreshToken: string, ctx: RequestContext): Promise<IssuedTokens> {
    const tokenHash = sha256(rawRefreshToken);
    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!existing || existing.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired, please sign in again');
    }
    if (existing.revokedAt) {
      // Reuse of an already-rotated token → likely theft. Revoke the whole
      // family (all of the user's sessions) and refuse.
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await this.audit.record({
        actorId: existing.userId,
        action: 'auth.refresh.reuse_detected',
        entityType: 'User',
        entityId: existing.userId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
      });
      throw new UnauthorizedException('Session is no longer valid');
    }
    if (!existing.user.isActive) {
      throw new UnauthorizedException('Account is not active');
    }

    // Rotate: issue new, mark old as replaced.
    const tokens = await this.issueTokens(existing.user, ctx);
    await this.prisma.refreshToken.update({
      where: { id: existing.id },
      data: { revokedAt: new Date(), replacedById: sha256(tokens.refreshToken) },
    });
    return tokens;
  }

  // --- Logout -------------------------------------------------------------
  async logout(rawRefreshToken: string | undefined, userId?: string): Promise<void> {
    if (rawRefreshToken) {
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash: sha256(rawRefreshToken), revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    if (userId) {
      await this.audit.record({
        actorId: userId,
        action: 'auth.logout',
        entityType: 'User',
        entityId: userId,
      });
    }
  }

  /** Revoke every active session for a user (e.g. after password change/reset). */
  async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  // --- Password change ----------------------------------------------------
  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
    ctx: RequestContext,
  ): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user || !user.passwordHash) throw new UnauthorizedException();

    const ok = await this.passwords.verify(user.passwordHash, currentPassword);
    if (!ok) throw new UnauthorizedException('Current password is incorrect');

    const violations = this.passwords.validateStrength(newPassword);
    if (violations.length) throw new BadRequestException(violations);

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await this.passwords.hash(newPassword), mustChangePassword: false },
    });
    await this.revokeAllSessions(userId);
    await this.audit.record({
      actorId: userId,
      action: 'auth.password.change',
      entityType: 'User',
      entityId: userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }

  // --- Forgot / reset -----------------------------------------------------
  /**
   * Always returns void (no signal about whether the email exists). If a user
   * exists, a hashed, expiring, single-use reset token is created and the raw
   * token returned to the caller for out-of-band delivery (email). In Phase 1
   * without an email provider, the token is logged/audited server-side only.
   */
  async requestPasswordReset(email: string, ctx: RequestContext): Promise<string | null> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    // Audit the request regardless, but never leak existence to the caller.
    await this.audit.record({
      actorId: user?.id ?? null,
      actorLabel: email,
      action: 'auth.password.reset_requested',
      entityType: 'User',
      entityId: user?.id ?? null,
      metadata: { userFound: Boolean(user) },
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
    if (!user) return null;

    const rawToken = generateToken(32);
    await this.prisma.passwordReset.create({
      data: {
        userId: user.id,
        tokenHash: sha256(rawToken),
        expiresAt: new Date(Date.now() + this.resetTtlMin * 60_000),
      },
    });
    return rawToken;
  }

  async resetPassword(rawToken: string, newPassword: string, ctx: RequestContext): Promise<void> {
    const record = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: sha256(rawToken) },
    });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired');
    }
    const violations = this.passwords.validateStrength(newPassword);
    if (violations.length) throw new BadRequestException(violations);

    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash: await this.passwords.hash(newPassword), mustChangePassword: false },
      }),
      this.prisma.passwordReset.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
      // Invalidate all sessions on reset.
      this.prisma.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    await this.audit.record({
      actorId: record.userId,
      action: 'auth.password.reset',
      entityType: 'User',
      entityId: record.userId,
      ip: ctx.ip,
      userAgent: ctx.userAgent,
    });
  }
}
