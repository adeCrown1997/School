import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthPrincipal } from '../../common/auth-principal';
import { ok } from '../../common/api-response';
import { ProfileService } from './profile.service';
import { CreateChangeRequestDto, UpdateOwnProfileDto } from './dto/profile.dto';

/**
 * STUDENT-FACING self-service endpoints under /api/v1/me. Authenticated-only —
 * authority is by OWNERSHIP (the principal's linked studentRecordId), NOT by a
 * permission, and the service refuses any caller without a student record. A
 * student can read their own record, edit their own contact profile, and raise
 * or cancel identity change requests — never edit identity directly.
 */
@Controller('me')
@UseGuards(JwtAuthGuard)
export class StudentSelfController {
  constructor(private readonly profile: ProfileService) {}

  private ctx(req: Request) {
    return { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string) ?? null };
  }

  @Get('profile')
  async getProfile(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.profile.getOwnProfile(user));
  }

  @Patch('profile')
  async updateProfile(
    @Body() dto: UpdateOwnProfileDto,
    @CurrentUser() user: AuthPrincipal,
    @Req() req: Request,
  ) {
    return ok(await this.profile.updateOwnProfile(user, dto, this.ctx(req)));
  }

  @Get('change-requests')
  async listMine(@CurrentUser() user: AuthPrincipal) {
    return ok(await this.profile.listOwnChangeRequests(user));
  }

  @Post('change-requests')
  async createRequest(
    @Body() dto: CreateChangeRequestDto,
    @CurrentUser() user: AuthPrincipal,
    @Req() req: Request,
  ) {
    return ok(await this.profile.createChangeRequest(user, dto, this.ctx(req)));
  }

  @Post('change-requests/:id/cancel')
  @HttpCode(200)
  async cancelRequest(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthPrincipal,
    @Req() req: Request,
  ) {
    return ok(await this.profile.cancelOwnChangeRequest(user, id, this.ctx(req)));
  }
}
