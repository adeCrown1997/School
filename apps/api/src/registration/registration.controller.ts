import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { WindowType } from '@prisma/client';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../auth/permissions.guard';
import { RequirePermissions } from '../auth/decorators';
import { PERMISSIONS } from '../rbac/permissions.catalog';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPrincipal } from '../common/auth-principal';
import { CalendarService } from './calendar.service';
import { RegistrationService } from './registration.service';
import { RegistrationPolicyService } from './registration-policy.service';
import {
  AddCoursesDto,
  CreateCalendarWindowDto,
  DecideRegistrationDto,
  DropLineDto,
  ListRegistrationsQueryDto,
  ListWindowsQueryDto,
  OpenDraftDto,
  PeriodQueryDto,
  SubmitRegistrationDto,
  UpdateCalendarWindowDto,
  UpdateRegistrationPolicyDto,
} from './dto/registration.dto';

/**
 * STAFF registration endpoints (docs/03 §9).
 *
 * The permission on each route is the separation of duties made mechanical: view,
 * manage (edit on a student's behalf), approve, and lock are four different keys
 * precisely so the adviser who approves cannot be the officer who locks, and
 * neither can quietly rewrite the course list first. Scope narrowing happens in
 * the service, which is the only place that knows which student a registration
 * belongs to.
 *
 * Literal routes are declared before `:id` because the id is UUID-parsed: without
 * that ordering, GET /registrations/policy would be rejected as a malformed uuid
 * instead of reaching its handler.
 */
@Controller('registrations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RegistrationController {
  constructor(
    private readonly registrations: RegistrationService,
    private readonly policy: RegistrationPolicyService,
    private readonly calendar: CalendarService,
  ) {}

  // --- listing -------------------------------------------------------------

  @Get()
  @RequirePermissions(PERMISSIONS.REGISTRATION_VIEW)
  list(@Query() q: ListRegistrationsQueryDto, @CurrentUser() user: AuthPrincipal) {
    return this.registrations.list(user, q);
  }

  // --- policy --------------------------------------------------------------

  /**
   * Readable with REGISTRATION_VIEW because staff enforcing a rule need to see
   * it; writable only with ACADEMIC_CONFIG_MANAGE, which is where the credit
   * policy already lives. The two are the same kind of decision — how the
   * institution reads its own regulations — and should not need two authorities.
   */
  @Get('policy')
  @RequirePermissions(PERMISSIONS.REGISTRATION_VIEW)
  getPolicy() {
    return this.policy.get();
  }

  @Post('policy')
  @RequirePermissions(PERMISSIONS.ACADEMIC_CONFIG_MANAGE)
  setPolicy(@Body() dto: UpdateRegistrationPolicyDto, @CurrentUser() user: AuthPrincipal) {
    return this.policy.set(dto, user);
  }

  // --- calendar windows ----------------------------------------------------

  /**
   * Registration windows are part of the ACADEMIC CALENDAR, which STRUCTURE_MANAGE
   * already owns (sessions and semesters live there), so no new permission key is
   * invented for them. Reading is open to anyone who can see registrations: the
   * dates are the answer to most "why can't I register" questions.
   */
  @Get('windows')
  @RequirePermissions(PERMISSIONS.REGISTRATION_VIEW)
  listWindows(@Query() q: ListWindowsQueryDto) {
    return this.calendar.listWindows({
      windowType: q.windowType as WindowType | undefined,
      sessionId: q.sessionId,
      semesterId: q.semesterId,
      includeInactive: q.includeInactive,
    });
  }

  @Post('windows')
  @RequirePermissions(PERMISSIONS.STRUCTURE_MANAGE)
  createWindow(@Body() dto: CreateCalendarWindowDto, @CurrentUser() user: AuthPrincipal) {
    return this.calendar.createWindow({ ...dto, windowType: dto.windowType as WindowType }, user);
  }

  @Patch('windows/:id')
  @RequirePermissions(PERMISSIONS.STRUCTURE_MANAGE)
  updateWindow(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: UpdateCalendarWindowDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.calendar.updateWindow(id, dto, user);
  }

  // --- one student ---------------------------------------------------------

  /** Eligibility gates, available courses and the registration itself — the same
   *  screen the student sees, which is what makes a support call answerable. */
  @Get('students/:studentRecordId/context')
  @RequirePermissions(PERMISSIONS.REGISTRATION_VIEW)
  studentContext(
    @Param('studentRecordId', new ParseUUIDPipe()) studentRecordId: string,
    @Query() q: PeriodQueryDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.registrations.contextForStaff(studentRecordId, user, q.sessionId, q.semesterId);
  }

  @Post('students/:studentRecordId/draft')
  @RequirePermissions(PERMISSIONS.REGISTRATION_MANAGE)
  openDraft(
    @Param('studentRecordId', new ParseUUIDPipe()) studentRecordId: string,
    @Body() dto: OpenDraftDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.registrations.openDraft(studentRecordId, user, dto.sessionId, dto.semesterId);
  }

  @Get(':id')
  @RequirePermissions(PERMISSIONS.REGISTRATION_VIEW)
  findOne(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthPrincipal) {
    return this.registrations.findOneForStaff(id, user);
  }

  // --- editing on a student's behalf ---------------------------------------

  @Post(':id/lines')
  @RequirePermissions(PERMISSIONS.REGISTRATION_MANAGE)
  addLines(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: AddCoursesDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.registrations.addCourses(id, dto.offeringIds, user, { onBehalf: true });
  }

  /**
   * Dropping a CARRYOVER additionally requires registration.exception.review — the
   * authority that would have ruled on the written request (R5). The service
   * enforces that and records the override.
   */
  @Delete(':id/lines/:lineId')
  @RequirePermissions(PERMISSIONS.REGISTRATION_MANAGE)
  dropLine(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('lineId', new ParseUUIDPipe()) lineId: string,
    @Body() dto: DropLineDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.registrations.dropLine(id, lineId, user, { onBehalf: true, reason: dto.reason });
  }

  @Post(':id/submit')
  @RequirePermissions(PERMISSIONS.REGISTRATION_MANAGE)
  @HttpCode(200)
  submit(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: SubmitRegistrationDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.registrations.submit(id, user, {
      idempotencyKey: dto.idempotencyKey,
      onBehalf: true,
    });
  }

  // --- approval chain ------------------------------------------------------

  /** One stage's decision. Which stage is not the caller's choice: it is the first
   *  active REGISTRATION stage still unsigned, and the actor must hold its role. */
  @Post(':id/decision')
  @RequirePermissions(PERMISSIONS.REGISTRATION_APPROVE)
  @HttpCode(200)
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() dto: DecideRegistrationDto,
    @CurrentUser() user: AuthPrincipal,
  ) {
    return this.registrations.decide(id, user, { decision: dto.decision, comment: dto.comment });
  }

  @Post(':id/lock')
  @RequirePermissions(PERMISSIONS.REGISTRATION_LOCK)
  @HttpCode(200)
  lock(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() user: AuthPrincipal) {
    return this.registrations.lock(id, user);
  }
}
