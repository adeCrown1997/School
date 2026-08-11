import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AcademicsModule } from '../academics/academics.module';
import { CalendarService } from './calendar.service';
import { CourseListService } from './course-list.service';
import { EligibilityService } from './eligibility.service';
import { RegistrationPolicyService } from './registration-policy.service';
import { RegistrationService } from './registration.service';
import { RegistrationController } from './registration.controller';
import { RegistrationSelfController } from './registration-self.controller';

/**
 * Course registration module (docs/03 §8–§9).
 *
 * Five services, layered deliberately:
 *   CalendarService          — the system clock: is this window open for this scope?
 *   RegistrationPolicyService — how strictly the rules are read (BLOCK vs WARN)
 *   EligibilityService       — the five gates a student must pass to register at all
 *   CourseListService        — what this student may take this semester, and why not
 *   RegistrationService      — the lifecycle, seat claims and approval chain
 *
 * AcademicsModule supplies AcademicConfigService (the credit policy: min/max units
 * per semester), which registration reads rather than duplicating — the unit
 * ceiling is one institutional number, not one per module. AuthModule is imported
 * because the controllers' guards are instantiated in this module's injector and
 * need JwtService.
 *
 * CalendarService is exported: clearance, results release and every other
 * time-gated feature asks it the same question, and none of them should grow its
 * own date columns.
 */
@Module({
  imports: [AuthModule, AcademicsModule],
  providers: [
    CalendarService,
    RegistrationPolicyService,
    EligibilityService,
    CourseListService,
    RegistrationService,
  ],
  controllers: [RegistrationController, RegistrationSelfController],
  exports: [CalendarService, RegistrationPolicyService, CourseListService, RegistrationService],
})
export class RegistrationModule {}
