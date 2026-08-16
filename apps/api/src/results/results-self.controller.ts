import {
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPrincipal } from '../common/auth-principal';
import { ok } from '../common/api-response';
import { assertStudentPrincipal, ResultsSelfService } from './results-self.service';

/**
 * Student-facing results under /api/v1/me/results. Authenticated-only; authority
 * is OWNERSHIP (the principal's linked studentRecordId), the same posture as
 * /me/registration. Published grades only, withholdings surfaced with reasons.
 */
@Controller('me/results')
@UseGuards(JwtAuthGuard)
export class ResultsSelfController {
  constructor(private readonly self: ResultsSelfService) {}

  /** Grades, per-semester GPA table and active withholdings in one call. */
  @Get()
  async ownResults(@CurrentUser() user: AuthPrincipal) {
    const studentRecordId = assertStudentPrincipal(user);
    return ok(await this.self.own(studentRecordId));
  }

  /**
   * One grade row. Must belong to the caller — a non-owner gets a 404 rather
   * than a 403, so the existence of another student's record is never confirmed.
   */
  @Get(':id')
  async ownGrade(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthPrincipal) {
    const studentRecordId = assertStudentPrincipal(user);
    const grade = await this.self.findOne(id, studentRecordId);
    if (!grade) throw new NotFoundException('Grade record not found');
    return ok(grade);
  }
}
