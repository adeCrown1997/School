import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../auth/permissions.guard';
import { RequirePermissions } from '../../auth/decorators';
import { PERMISSIONS } from '../../rbac/permissions.catalog';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthPrincipal } from '../../common/auth-principal';
import { paginatedResponse } from '../../common/pagination';
import { ok } from '../../common/api-response';
import { ProfileService } from './profile.service';
import { ListChangeRequestsQueryDto, ReviewChangeRequestDto } from './dto/profile.dto';

/**
 * REGISTRY-FACING change-request review endpoints under /api/v1/change-requests.
 * Permission-guarded and scope-limited: a reviewer sees/decides only requests
 * for records within their assigned scope. Approval routes the correction
 * through the amendment function; separation of duties is enforced (a reviewer
 * cannot decide a request they filed).
 */
@Controller('change-requests')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ChangeRequestController {
  constructor(private readonly profile: ProfileService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CHANGE_REQUESTS_VIEW)
  async list(@Query() query: ListChangeRequestsQueryDto, @CurrentUser() user: AuthPrincipal) {
    return paginatedResponse(await this.profile.listChangeRequests(query, user));
  }

  @Post(':id/review')
  @RequirePermissions(PERMISSIONS.CHANGE_REQUESTS_REVIEW)
  async review(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewChangeRequestDto,
    @CurrentUser() user: AuthPrincipal,
    @Req() req: Request,
  ) {
    const ctx = { ip: req.ip ?? null, userAgent: (req.headers['user-agent'] as string) ?? null };
    return ok(await this.profile.reviewChangeRequest(id, dto, user, ctx));
  }
}
