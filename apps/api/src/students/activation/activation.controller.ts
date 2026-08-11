import { Body, Controller, HttpCode, Post, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { Public } from '../../auth/decorators';
import { ActivationService } from './activation.service';
import {
  ActivationIdentifyDto,
  ActivationSetPasswordDto,
  ActivationVerifyOtpDto,
} from './dto/activation.dto';

/**
 * Public student-activation endpoints under /api/v1/students/activate. These are
 * the ONLY unauthenticated student-facing routes — there is NO "create account"
 * / self-signup. Each step is IP-throttled on top of the per-record lockout in
 * the service to blunt brute force. Steps 1 & 2 always return a generic body so
 * the endpoints cannot be used to enumerate valid matriculation numbers.
 */
@Controller('students/activate')
export class ActivationController {
  constructor(private readonly activation: ActivationService) {}

  private ctx(req: Request) {
    return {
      ip: req.ip ?? null,
      userAgent: (req.headers['user-agent'] as string) ?? null,
    };
  }

  /**
   * The one route the student-facing client calls. With email verification off
   * (the default) this completes activation outright; with it on, it sends the
   * OTP and the client continues to /verify. `emailVerificationRequired` tells
   * the client which happened, so the UI needs no build-time knowledge of the
   * server's configuration.
   */
  @Public()
  @Post()
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async activate(@Body() dto: ActivationIdentifyDto, @Req() req: Request) {
    const data = await this.activation.activate(dto, this.ctx(req));
    return {
      ok: true,
      data: { ...data, emailVerificationRequired: this.activation.emailVerificationEnabled },
    };
  }

  /** Retained entry point for the OTP flow's first step. */
  @Public()
  @Post('identify')
  @HttpCode(202)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async identify(@Body() dto: ActivationIdentifyDto, @Req() req: Request) {
    const data = await this.activation.identify(dto, this.ctx(req));
    return { ok: true, data };
  }

  @Public()
  @Post('verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async verify(@Body() dto: ActivationVerifyOtpDto, @Req() req: Request) {
    const data = await this.activation.verifyOtp(dto, this.ctx(req));
    return { ok: true, data };
  }

  @Public()
  @Post('set-password')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async setPassword(@Body() dto: ActivationSetPasswordDto, @Req() req: Request) {
    const data = await this.activation.setPassword(dto, this.ctx(req));
    return { ok: true, data };
  }
}
