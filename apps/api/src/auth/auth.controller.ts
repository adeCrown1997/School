import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ConfigService } from '@nestjs/config';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, ResetPasswordDto } from './dto/auth.dto';
import { REFRESH_COOKIE, clearAuthCookies, setAuthCookies } from './cookies';
import { JwtAuthGuard } from './jwt-auth.guard';
import { Public } from './decorators';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPrincipal } from '../common/auth-principal';

/**
 * Auth endpoints under /api/v1/auth. There is deliberately NO registration /
 * self-signup endpoint here — accounts are provisioned by admins or created via
 * the student-activation ceremony (separate module). Sensitive endpoints are
 * rate-limited to blunt brute force.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService,
  ) {}

  private ctx(req: Request) {
    return {
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    };
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } }) // 5 attempts / minute / IP
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const tokens = await this.auth.login(dto.email, dto.password, this.ctx(req));
    setAuthCookies(res, tokens, this.config);
    return { ok: true, data: { authenticated: true } };
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE];
    const tokens = await this.auth.refresh(raw ?? '', this.ctx(req));
    setAuthCookies(res, tokens, this.config);
    return { ok: true, data: { refreshed: true } };
  }

  @Post('logout')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthPrincipal,
  ) {
    const raw = (req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE];
    await this.auth.logout(raw, user.userId);
    clearAuthCookies(res, this.config);
    return { ok: true, data: { loggedOut: true } };
  }

  /** Returns the current principal — used by the frontend to render by role. */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthPrincipal) {
    return {
      ok: true,
      data: {
        userId: user.userId,
        userType: user.userType,
        email: user.email,
        fullName: user.fullName,
        permissions: user.permissions,
        studentRecordId: user.studentRecordId ?? null,
      },
    };
  }

  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @CurrentUser() user: AuthPrincipal,
  ) {
    await this.auth.changePassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
      this.ctx(req),
    );
    // Sessions were revoked; clear cookies so the client re-authenticates.
    clearAuthCookies(res, this.config);
    return { ok: true, data: { changed: true } };
  }

  @Public()
  @Post('forgot-password')
  @HttpCode(202)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async forgotPassword(@Body() dto: ForgotPasswordDto, @Req() req: Request) {
    // Never reveals whether the account exists.
    await this.auth.requestPasswordReset(dto.email, this.ctx(req));
    return {
      ok: true,
      data: { message: 'If that account exists, a password reset link has been sent.' },
    };
  }

  @Public()
  @Post('reset-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async resetPassword(@Body() dto: ResetPasswordDto, @Req() req: Request) {
    await this.auth.resetPassword(dto.token, dto.newPassword, this.ctx(req));
    return { ok: true, data: { reset: true } };
  }
}
