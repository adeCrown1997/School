import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPrincipal } from '../common/auth-principal';
import { ok } from '../common/api-response';
import { RegistrationService } from './registration.service';
import {
  AddCoursesDto,
  DropLineDto,
  OpenDraftDto,
  PeriodQueryDto,
  SubmitRegistrationDto,
} from './dto/registration.dto';

/**
 * STUDENT self-service registration, under /api/v1/me.
 *
 * Authenticated-only: authority here is OWNERSHIP (the principal's linked
 * studentRecordId), never a permission — the STUDENT role deliberately holds
 * none. Every route resolves the caller's own record through
 * RegistrationService.ownRecordId, so a staff principal wandering in gets a clear
 * refusal rather than someone else's data.
 *
 * `history` is declared before `:id` because the id is UUID-parsed and would
 * otherwise reject the literal path.
 */
@Controller('me/registration')
@UseGuards(JwtAuthGuard)
export class RegistrationSelfController {
  constructor(private readonly registrations: RegistrationService) {}

  /**
   * The whole screen in one call: the five eligibility gates, the available course
   * list with its exclusions, and the registration if one exists. One round trip
   * because the three answers must describe the same semester — a client that
   * fetched them separately could straddle a rollover.
   */
  @Get()
  async current(@Query() q: PeriodQueryDto, @CurrentUser() user: AuthPrincipal) {
    const studentRecordId = this.registrations.ownRecordId(user);
    return ok(await this.registrations.context(studentRecordId, q.sessionId, q.semesterId));
  }

  @Get('history')
  async history(@CurrentUser() user: AuthPrincipal) {
    const studentRecordId = this.registrations.ownRecordId(user);
    return ok(await this.registrations.listOwn(studentRecordId));
  }

  @Get(':id')
  async findOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthPrincipal) {
    return ok(await this.registrations.findOneForStudent(id, user));
  }

  /** Idempotent: an existing draft (or an already-submitted registration) is
   *  returned rather than refused, so a double tap cannot produce an error. */
  @Post('draft')
  async openDraft(@Body() dto: OpenDraftDto, @CurrentUser() user: AuthPrincipal) {
    const studentRecordId = this.registrations.ownRecordId(user);
    return ok(
      await this.registrations.openDraft(studentRecordId, user, dto.sessionId, dto.semesterId),
    );
  }

  /**
   * Add courses. Validated against the student's own §9.2 list, so nothing can be
   * registered that was not offered — including the capacity and prerequisite
   * verdicts the list already carries.
   */
  @Post(':id/courses')
  @HttpCode(200)
  async addCourses(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddCoursesDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    this.registrations.ownRecordId(user);
    return ok(await this.registrations.addCourses(id, dto.offeringIds, user));
  }

  /** Carryovers are refused here (R5): removing one needs the registry. */
  @Delete(':id/courses/:lineId')
  async dropCourse(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Body() dto: DropLineDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    this.registrations.ownRecordId(user);
    return ok(await this.registrations.dropLine(id, lineId, user, { reason: dto.reason }));
  }

  /**
   * Submit for approval — the moment seats are claimed. Send an idempotencyKey:
   * this is the one call where a lost response is expensive, and a retry carrying
   * the same key returns the same registration instead of trying to claim twice.
   */
  @Post(':id/submit')
  @HttpCode(200)
  async submit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SubmitRegistrationDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    this.registrations.ownRecordId(user);
    return ok(await this.registrations.submit(id, user, { idempotencyKey: dto.idempotencyKey }));
  }
}
