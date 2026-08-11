import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * Registration DTOs (docs/03 §9).
 *
 * Two conventions worth stating, because they are the reason several fields look
 * more restrictive than they need to be:
 *
 *   • The PERIOD is always optional. A student's client should be able to say
 *     "my registration" and get the current session/semester; passing ids is for
 *     staff looking at a specific period, and a mismatched pair is rejected by
 *     the service rather than silently reinterpreted.
 *   • Enum-ish fields are validated with @Matches against an explicit spelling
 *     rather than @IsEnum over the Prisma enum. The API contract should not move
 *     the moment someone adds an enum value for an unrelated feature.
 */

/** Coerce a query-string boolean; see academics.dto for why not @Type(Boolean). */
const BooleanQuery = () =>
  Transform(({ value }) => {
    if (typeof value === 'boolean') return value;
    if (value === undefined || value === null || value === '') return undefined;
    const v = String(value).trim().toLowerCase();
    if (v === 'true' || v === '1' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'no') return false;
    return value;
  });

const REGISTRATION_STATUS = /^(DRAFT|PENDING_APPROVAL|APPROVED|LOCKED|REJECTED|CANCELLED)$/;
/** Only the registration-family windows are managed through this module. */
const REGISTRATION_WINDOW_TYPE = /^(REGISTRATION|ADD_DROP|LATE_REGISTRATION)$/;

// --- period ----------------------------------------------------------------

export class PeriodQueryDto {
  @IsOptional() @IsUUID() sessionId?: string;
  @IsOptional() @IsUUID() semesterId?: string;
}

export class OpenDraftDto {
  @IsOptional() @IsUUID() sessionId?: string;
  @IsOptional() @IsUUID() semesterId?: string;
}

// --- lines -----------------------------------------------------------------

export class AddCoursesDto {
  /**
   * Offerings, not courses: a course exists in the catalogue, but only an
   * offering exists in a semester with a capacity to claim.
   *
   * The cap of 40 is a sanity bound, not a policy — the unit ceiling is what
   * actually limits a registration, and it lives in academic.credit_policy.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(40)
  @IsUUID('4', { each: true })
  offeringIds!: string[];
}

export class DropLineDto {
  /** Optional for a student, materially useful for staff: a drop made on someone
   *  else's behalf should say why, and the audit record keeps it. */
  @IsOptional() @IsString() @Length(3, 500) reason?: string;
}

export class SubmitRegistrationDto {
  /**
   * Client-generated retry key. Submission is the one operation where a lost
   * response is expensive — the student cannot tell "it failed" from "the reply
   * never arrived" — so a retry carrying the same key returns the same
   * registration instead of attempting a second seat claim.
   */
  @IsOptional() @IsString() @Length(8, 100) idempotencyKey?: string;
}

// --- approval --------------------------------------------------------------

export class DecideRegistrationDto {
  @IsString()
  @Matches(/^(APPROVED|REJECTED)$/, { message: 'decision must be APPROVED or REJECTED' })
  decision!: 'APPROVED' | 'REJECTED';

  /** Required for a rejection (enforced in the service): a student who is told
   *  "rejected" with no reason has to guess what to change. */
  @IsOptional() @IsString() @Length(3, 1000) comment?: string;
}

// --- staff listing ---------------------------------------------------------

export class ListRegistrationsQueryDto {
  @IsOptional() @IsUUID() sessionId?: string;
  @IsOptional() @IsUUID() semesterId?: string;

  @IsOptional()
  @IsString()
  @Matches(REGISTRATION_STATUS, {
    message: 'status must be DRAFT, PENDING_APPROVAL, APPROVED, LOCKED, REJECTED or CANCELLED',
  })
  status?: 'DRAFT' | 'PENDING_APPROVAL' | 'APPROVED' | 'LOCKED' | 'REJECTED' | 'CANCELLED';

  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(1200) level?: number;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() programmeId?: string;
  @IsOptional() @IsString() @Length(1, 100) search?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

// --- registration policy ---------------------------------------------------

export class UpdateRegistrationPolicyDto {
  @IsOptional()
  @IsString()
  @Matches(/^(BLOCK|WARN)$/, { message: 'prerequisiteEnforcement must be BLOCK or WARN' })
  prerequisiteEnforcement?: 'BLOCK' | 'WARN';

  /** How many levels above their own a student may reach. Bounded at 3 by the
   *  service: wider than that and the curriculum sequence means nothing. */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(3) levelSpread?: number;

  @IsOptional() @IsBoolean() allowRepeatForUpgrade?: boolean;
  @IsOptional() @IsBoolean() enforceCapacity?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^(BLOCK|WARN)$/, { message: 'timetableClash must be BLOCK or WARN' })
  timetableClash?: 'BLOCK' | 'WARN';
}

// --- calendar windows ------------------------------------------------------

export class ListWindowsQueryDto {
  @IsOptional()
  @IsString()
  @Matches(REGISTRATION_WINDOW_TYPE, {
    message: 'windowType must be REGISTRATION, ADD_DROP or LATE_REGISTRATION',
  })
  windowType?: 'REGISTRATION' | 'ADD_DROP' | 'LATE_REGISTRATION';

  @IsOptional() @IsUUID() sessionId?: string;
  @IsOptional() @IsUUID() semesterId?: string;
  @IsOptional() @BooleanQuery() @IsBoolean() includeInactive?: boolean;
}

export class CreateCalendarWindowDto {
  /**
   * Restricted to the registration family on purpose. A RESULT_RELEASE window is
   * dual-approved (Q-35) because premature release cannot be undone, and exposing
   * it on a registration endpoint would route around that requirement.
   */
  @IsString()
  @Matches(REGISTRATION_WINDOW_TYPE, {
    message: 'windowType must be REGISTRATION, ADD_DROP or LATE_REGISTRATION',
  })
  windowType!: 'REGISTRATION' | 'ADD_DROP' | 'LATE_REGISTRATION';

  @IsUUID() sessionId!: string;
  /** Null/absent means the window covers the whole session. */
  @IsOptional() @IsUUID() semesterId?: string;

  /**
   * GLOBAL unless a wave is being opened. Staggered registration by department is
   * the cheapest load control there is (§9.5), and it is expressed here rather
   * than in code.
   */
  @IsOptional()
  @IsString()
  @Matches(/^(GLOBAL|FACULTY|DEPARTMENT|PROGRAMME)$/, {
    message: 'scopeType must be GLOBAL, FACULTY, DEPARTMENT or PROGRAMME',
  })
  scopeType?: 'GLOBAL' | 'FACULTY' | 'DEPARTMENT' | 'PROGRAMME';

  @IsOptional() @IsUUID() facultyId?: string;
  @IsOptional() @IsUUID() departmentId?: string;
  @IsOptional() @IsUUID() programmeId?: string;

  /** ISO 8601. Send an explicit offset or Z — a bare local time is ambiguous the
   *  moment the API and the client sit in different zones. */
  @IsString() @Length(10, 40) opensAt!: string;
  @IsString() @Length(10, 40) closesAt!: string;

  @IsOptional() @IsString() @Length(0, 500) notes?: string;
}

export class UpdateCalendarWindowDto {
  @IsOptional() @IsString() @Length(10, 40) opensAt?: string;
  @IsOptional() @IsString() @Length(10, 40) closesAt?: string;
  @IsOptional() @IsString() @Length(0, 500) notes?: string;

  /** The emergency switch. Separate from the dates so suspending a window does
   *  not rewrite what was published (see CalendarWindow.isActive). */
  @IsOptional() @IsBoolean() isActive?: boolean;
}
